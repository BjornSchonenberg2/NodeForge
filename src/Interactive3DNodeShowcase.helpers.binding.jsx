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

export function RackBinding({ n, setNode }) {
    const [name, setName] = React.useState(n.represent?.rack?.name || "");
    const [width, setWidth] = React.useState(n.represent?.rack?.width ?? 60);
    const [height, setHeight] = React.useState(n.represent?.rack?.height ?? 200);
    const [length, setLength] = React.useState(n.represent?.rack?.length ?? 80);
    const [weight, setWeight] = React.useState(n.represent?.rack?.weight ?? 0);
    const [rackId, setRackId] = React.useState(n.represent?.rackId || "");
    const [filter, setFilter] = React.useState("");
    const products = listProducts();
    const racks = listRacks();

    const unit = localStorage.getItem("epic3d.productUnits.v1") || "cm";
    const rack = React.useMemo(() => (rackId ? getRackById(rackId) : null), [rackId]);

    // ensure node has an inline rack object for editing
    React.useEffect(() => {
        if (!n.represent?.rack && !rack) {
            setNode(n.id, { represent: { ...(n.represent || {}), rack: { name, width, height, length, weight } } });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const items = React.useMemo(() => {
        // Prefer persisted rack's items if loaded, otherwise node-inline
        return (rack?.items) || (n.represent?.rack?.items) || [];
    }, [rack, n.represent?.rack?.items]);

    const addItem = (pid) => {
        if (!pid) return;
        const next = [...items, { productId: pid }];
        setNode(n.id, { represent: { ...(n.represent || {}), rack: { ...(n.represent?.rack || {}), items: next } } });
    };

    const removeItem = (pid) => {
        const next = items.filter(i => i.productId !== pid);
        setNode(n.id, { represent: { ...(n.represent || {}), rack: { ...(n.represent?.rack || {}), items: next } } });
    };

    const saveRack = () => {
        const payload = {
            id: rackId || undefined,
            name: name || "Rack",
            width, height, length, weight,
            items
        };
        const saved = upsertRack(payload);
        setRackId(saved.id);
        setNode(n.id, { represent: { ...(n.represent || {}), kind: "rack", rackId: saved.id, rack: { name: saved.name, width, height, length, weight, items } } });
    };
// Global shadows toggle (persisted)
// Global Shadows (persist)
    const [shadowsOn, setShadowsOn] = useState(
        () => localStorage.getItem("epic3d.shadowsOn.v1") !== "0"
    );
    useEffect(() => {
        try { localStorage.setItem("epic3d.shadowsOn.v1", shadowsOn ? "1" : "0"); } catch {}
    }, [shadowsOn]);


    const loadRack = (id) => {
        setRackId(id);
        const r = id ? getRackById(id) : null;
        if (r) {
            setName(r.name || "");
            setWidth(r.width ?? width);
            setHeight(r.height ?? height);
            setLength(r.length ?? length);
            setWeight(r.weight ?? weight);
            setNode(n.id, { represent: { ...(n.represent || {}), kind: "rack", rackId: r.id, rack: { ...r } } });
        }
    };

    const delRack = () => {
        if (!rackId) return;
        deleteRack(rackId);
        setRackId("");
    };

    const productOptions = React.useMemo(() => {
        const q = (filter || "").toLowerCase();
        return (products || [])
            .map(p => ({ id: p.id, label: [p.category, p.make, p.model, p.name].filter(Boolean).join(" › "), p }))
            .filter(o => o.label.toLowerCase().includes(q));
    }, [products, filter]);

    return (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed rgba(255,255,255,0.15)" }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Rack</div>

            <div style={{ display: "grid", gap: 8 }}>
                <label>
                    Load existing
                    <Select value={rackId} onChange={(e) => loadRack(e.target.value)}>
                        <option value="">(none)</option>
                        {racks.map(r => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
                    </Select>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <label>
                        Name
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                    </label>
                    <Btn onClick={saveRack} variant="primary" glow>Save</Btn>
                </div>

                <div style={{ fontSize: 12, opacity: 0.85 }}>Dimensions ({unit})</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    <label>W<Input type="number" step="1" value={width} onChange={(e)=>setWidth(Number(e.target.value)||0)} /></label>
                    <label>H<Input type="number" step="1" value={height} onChange={(e)=>setHeight(Number(e.target.value)||0)} /></label>
                    <label>L<Input type="number" step="1" value={length} onChange={(e)=>setLength(Number(e.target.value)||0)} /></label>
                    <label>Weight<Input type="number" step="0.1" value={weight} onChange={(e)=>setWeight(Number(e.target.value)||0)} /></label>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ fontWeight: 800 }}>Products in Rack</div>
                    {rackId && <Btn onClick={delRack}>Delete Rack</Btn>}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <label>
                        Filter
                        <Input value={filter} onChange={(e)=>setFilter(e.target.value)} placeholder="Type to filter…" />
                    </label>
                    <label>
                        Add
                        <Select onChange={(e)=>{ addItem(e.target.value); e.target.value=""; }}>
                            <option value="">+ Choose product</option>
                            {productOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </Select>
                    </label>
                </div>

                {items.length === 0 && <div style={{ opacity: 0.75, fontSize: 12 }}>No products yet.</div>}
                {items.length > 0 && (
                    <div style={{ display: "grid", gap: 6 }}>
                        {items.map((it, i) => {
                            const p = (products || []).find(x => x.id === it.productId);
                            if (!p) return null;
                            return (
                                <div key={`${it.productId}-${i}`} style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "6px 8px", background: "rgba(255,255,255,0.04)"
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        {p.image && <img src={p.image} alt={p.name} style={{ width: 40, height: 28, objectFit: "cover", borderRadius: 6 }} />}
                                        <div style={{ fontSize: 12 }}>
                                            <div style={{ fontWeight: 800 }}>{p.name}</div>
                                            <div style={{ opacity: 0.8 }}>{[p.category, p.make, p.model].filter(Boolean).join(" › ")}</div>
                                        </div>
                                    </div>
                                    <Btn onClick={() => removeItem(it.productId)}>✕</Btn>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}


export function ProductBinding({ n, setNode }) {
    const [prodFilter, setProdFilter] = React.useState("");
    const products = listProducts();

    const options = React.useMemo(() => {
        const q = (prodFilter || "").toLowerCase();
        return (products || [])
            .map((p) => ({
                id: p.id,
                label: [p.category, p.make, p.model, p.name].filter(Boolean).join(" › "),
                p,
            }))
            .filter((o) => o.label.toLowerCase().includes(q));
    }, [products, prodFilter]);

    const bound = React.useMemo(() => {
        const id = n.product?.id;
        return id ? (products || []).find((p) => p.id === id) : null;
    }, [n.product?.id, products]);

    return (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed rgba(255,255,255,0.15)" }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Product</div>

            <label>
                Filter
                <Input value={prodFilter} onChange={(e) => setProdFilter(e.target.value)} placeholder="Type to filter…" />
            </label>

            <label>
                Choose
                <Select
                    value={n.product?.id || ""}
                    onChange={(e) => {
                        const id = e.target.value || "";
                        setNode(n.id, { product: id ? { id, useDims: true, showPhoto: true } : null });
                    }}
                >
                    <option value="">(none)</option>
                    {options.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.label}
                        </option>
                    ))}
                </Select>
            </label>

            {n.product && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                    <Checkbox
                        checked={n.product.useDims ?? true}
                        onChange={(v) => setNode(n.id, { product: { ...(n.product || {}), useDims: v } })}
                        label="Use product dimensions"
                    />
                    <Checkbox
                        checked={n.product.showPhoto ?? true}
                        onChange={(v) => setNode(n.id, { product: { ...(n.product || {}), showPhoto: v } })}
                        label="Show photo in label"
                    />
                    <Checkbox
                        checked={n.product.showDims ?? false}
                        onChange={(v) => setNode(n.id, { product: { ...(n.product || {}), showDims: v } })}
                        label="Show dimensions (override)"
                    />
                </div>
            )}

            {bound && (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                    W×H×L: {(bound.width ?? bound.dims?.w) ?? 0} × {(bound.height ?? bound.dims?.h) ?? 0} × {(bound.length ?? bound.dims?.l) ?? 0}
                </div>
            )}
        </div>
    );
}

/* ============================ Per-node outgoing link editor ============================ */


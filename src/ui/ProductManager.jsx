// src/ui/ProductManager.jsx
// Epic 3-panel Product Catalogue (windowed modal):
// - Left: products list + search
// - Middle: editor + slideshow images (multi-drop, reorder, cover)
// - Right: DIRECTORY TREE with ALL productPictures (folders + image files)
//   -> drag one/multiple files onto Images panel to assign pictures.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import {
    listProducts,
    upsertProduct,
    deleteProduct,
    listCategories,
    ensureCategory,
    listMakes,
    ensureMake,
    listModels,
    ensureModel,
    exportProductsBlob,
    importProductsFile,
    mergeProductsFile,
} from "../data/products/store";

import {
    buildBundledProductPicturesIndex,
    buildDiskProductPicturesIndex,
    hasFs as hasFsPictures,
    resolvePictureRef,
} from "../data/products/productPicturesIndex";

import { Btn, Input } from "./Controls.jsx";

const DT_SINGLE = "application/x-nodeforge-picture-ref";
const DT_MULTI = "application/x-nodeforge-picture-refs";
const DT_IMG_INDEX = "application/x-nodeforge-image-index";

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

const Glass = ({ children, style }) => (
    <div
        style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 16,
            boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
            ...style,
        }}
    >
        {children}
    </div>
);

function Title({ children }) {
    return <div style={{ fontWeight: 950, fontSize: 13, opacity: 0.95, letterSpacing: 0.2 }}>{children}</div>;
}

/* ------------------------------- Images Editor ------------------------------- */
function ImagesEditor({ draft, setDraft, bundledIndex, diskIndex, markDirty }) {
    const [activeIdx, setActiveIdx] = useState(0);
    const fileRef = useRef(null);

    const images = Array.isArray(draft?.images) ? draft.images : (draft?.image ? [draft.image] : []);
    const idx = clamp(activeIdx, 0, Math.max(0, images.length - 1));
    const active = images[idx] || "";

    useEffect(() => setActiveIdx(0), [draft?.id]);

    const setImages = (arr) => {
        const cleaned = (arr || []).map((x) => String(x || "")).filter(Boolean);
        setDraft((d) => ({ ...d, images: cleaned, image: cleaned[0] || "" }));
        markDirty();
    };

    const addRefs = (refs) => {
        const incoming = (refs || []).map((x) => String(x || "")).filter(Boolean);
        if (!incoming.length) return;
        setImages([...(images || []), ...incoming]);
    };

    const removeAt = (i) => {
        const next = images.slice();
        next.splice(i, 1);
        setImages(next);
        setActiveIdx((x) => clamp(x, 0, Math.max(0, next.length - 1)));
    };

    const move = (from, to) => {
        if (from === to) return;
        const next = images.slice();
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        setImages(next);
        setActiveIdx((x) => (x === from ? to : x));
    };

    const onDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // From our tree
        const multi = e.dataTransfer.getData(DT_MULTI);
        const single = e.dataTransfer.getData(DT_SINGLE);
        if (multi) { try { addRefs(JSON.parse(multi)); return; } catch {} }
        if (single) { addRefs([single]); return; }

        // From OS files
        const files = Array.from(e.dataTransfer.files || []).filter((f) => f && (f.type || "").startsWith("image/"));
        if (!files.length) return;

        const canFs = !!(window?.require?.("fs"));
        if (canFs) {
            const fs = window.require("fs");
            const path = window.require("path");
            const base = process.cwd();
            const dir = path.join(base, "data", "media", "products");
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            for (const file of files) {
                const ext = (file.name || "").match(/\.[a-z0-9]+$/i)?.[0] || ".png";
                const fname = `${uuid()}${ext}`;
                const abs = path.join(dir, fname);
                const buf = await file.arrayBuffer();
                const BufferCtor = window.require?.("buffer")?.Buffer || Buffer;
                fs.writeFileSync(abs, BufferCtor.from(new Uint8Array(buf)));
                addRefs([`@media/products/${fname}`]);
            }
            return;
        }

        const urls = await Promise.all(files.map((f) => new Promise((res) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result || ""));
            fr.onerror = () => res("");
            fr.readAsDataURL(f);
        })));
        addRefs(urls.filter(Boolean));
    };

    return (
        <Glass style={{ padding: 12, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Title>Images (drop multiple)</Title>
                <div style={{ display: "flex", gap: 8 }}>
                    <Btn onClick={() => fileRef.current?.click?.()}>Add…</Btn>
                    <Btn onClick={() => { setImages([]); setActiveIdx(0); }}>Clear</Btn>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: "none" }}
                        onChange={async (e) => {
                            const files = Array.from(e.target.files || []).filter(Boolean);
                            e.target.value = "";
                            if (!files.length) return;
                            const fake = { preventDefault(){}, stopPropagation(){}, dataTransfer: { files, getData(){ return ""; } } };
                            await onDrop(fake);
                        }}
                    />
                </div>
            </div>

            <div
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                onDrop={onDrop}
                style={{
                    height: 220, borderRadius: 14,
                    border: "1px dashed rgba(255,255,255,0.22)",
                    background: "rgba(0,0,0,0.18)",
                    display: "grid", placeItems: "center", position: "relative", overflow: "hidden",
                }}
            >
                {active ? (
                    <img alt="" src={resolvePictureRef(active, bundledIndex, diskIndex) || active} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                    <div style={{ textAlign: "center", opacity: 0.85 }}>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>Drop images here</div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>Drag from the library tree or drop local files</div>
                    </div>
                )}

                {images.length > 1 && (
                    <div style={{ position: "absolute", inset: 10, display: "flex", justifyContent: "space-between", pointerEvents: "none" }}>
                        <div style={{ pointerEvents: "auto" }}><Btn onClick={() => setActiveIdx((i) => clamp(i - 1, 0, images.length - 1))}>◀</Btn></div>
                        <div style={{ pointerEvents: "auto" }}><Btn onClick={() => setActiveIdx((i) => clamp(i + 1, 0, images.length - 1))}>▶</Btn></div>
                    </div>
                )}
            </div>

            {images.length > 0 && (
                <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                    {images.map((ref, i) => (
                        <div
                            key={`${ref}-${i}`}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData(DT_IMG_INDEX, String(i)); e.dataTransfer.effectAllowed = "move"; }}
                            onDragOver={(e) => { if (e.dataTransfer.types.includes(DT_IMG_INDEX)) e.preventDefault(); }}
                            onDrop={(e) => {
                                const from = Number(e.dataTransfer.getData(DT_IMG_INDEX));
                                if (Number.isFinite(from)) move(from, i);
                            }}
                            onClick={() => setActiveIdx(i)}
                            style={{
                                width: 88, flex: "0 0 88px", borderRadius: 14, overflow: "hidden",
                                border: i === idx ? "1px solid rgba(124,255,255,0.45)" : "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.04)",
                                cursor: "pointer",
                            }}
                            title={ref}
                        >
                            <img alt="" src={resolvePictureRef(ref, bundledIndex, diskIndex) || ref} style={{ width: "100%", height: 64, objectFit: "cover", display: "block" }} />
                            <div style={{ display: "flex", gap: 6, padding: 6, justifyContent: "space-between" }}>
                                <Btn title="Set as cover" onClick={() => { if (i !== 0) { move(i, 0); setActiveIdx(0); } }}>⭐</Btn>
                                <Btn title="Remove" onClick={() => removeAt(i)}>🗑</Btn>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Glass>
    );
}

/* ------------------------------- File Tree ------------------------------- */
function TreeRow({ depth, active, children, onClick, onDoubleClick, draggable, onDragStart, title }) {
    return (
        <div
            title={title}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            draggable={draggable}
            onDragStart={onDragStart}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                paddingLeft: 8 + depth * 12,
                borderRadius: 10,
                cursor: "pointer",
                userSelect: "none",
                background: active ? "rgba(124,255,255,0.10)" : "transparent",
                border: active ? "1px solid rgba(124,255,255,0.20)" : "1px solid transparent",
            }}
        >
            {children}
        </div>
    );
}

function FolderFileTree({ root, search, selectedRefs, onToggleSelect, onAddToProduct }) {
    const [open, setOpen] = useState(() => new Set([""]));

    const toggleOpen = (path) => {
        setOpen((prev) => {
            const next = new Set(prev);
            next.has(path) ? next.delete(path) : next.add(path);
            return next;
        });
    };

    const q = String(search || "").trim().toLowerCase();

    // returns true if node should be shown
    const matchesNode = (n, path) => {
        if (!q) return true;
        if ((path === "" ? "productpictures" : n.name || "").toLowerCase().includes(q)) return true;
        for (const f of (n.files || [])) {
            const s = `${f.name} ${f.rel}`.toLowerCase();
            if (s.includes(q)) return true;
        }
        for (const k of Object.keys(n.dirs || {})) {
            if (matchesNode(n.dirs[k], path ? `${path}/${k}` : k)) return true;
        }
        return false;
    };

    const render = (n, path, depth) => {
        if (!matchesNode(n, path)) return null;

        const dirs = Object.keys(n.dirs || {}).sort((a,b)=>a.localeCompare(b));
        const files = (n.files || []).slice().sort((a,b)=> (a.name||"").localeCompare(b.name||""));
        const isOpen = open.has(path);

        const rows = [];

        // folder row
        rows.push(
            <TreeRow
                key={`dir:${path}`}
                depth={depth}
                active={false}
                title={path || "productPictures"}
                onClick={() => toggleOpen(path)}
            >
        <span style={{ width: 18, height: 18, display: "grid", placeItems: "center", borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)" }}>
          {dirs.length || files.length ? (isOpen ? "▾" : "▸") : "·"}
        </span>
                <span>📁</span>
                <span style={{ fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path === "" ? "productPictures" : n.name}
        </span>
                <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>
          {files.length}
        </span>
            </TreeRow>
        );

        if (!isOpen) return rows;

        // file leaves
        for (const f of files) {
            if (q) {
                const s = `${f.name} ${f.rel}`.toLowerCase();
                if (!s.includes(q)) continue;
            }
            const isSel = selectedRefs.has(f.ref);
            rows.push(
                <TreeRow
                    key={`file:${f.ref}`}
                    depth={depth + 1}
                    active={isSel}
                    title={f.rel}
                    onClick={(e) => onToggleSelect(f.ref, e.ctrlKey || e.metaKey)}
                    onDoubleClick={() => onAddToProduct(f.ref)}
                    draggable
                    onDragStart={(e) => {
                        const refs = Array.from(selectedRefs);
                        const payload = refs.includes(f.ref) ? refs : [f.ref];
                        e.dataTransfer.setData(DT_MULTI, JSON.stringify(payload));
                        e.dataTransfer.setData(DT_SINGLE, payload[0]);
                        e.dataTransfer.effectAllowed = "copy";
                    }}
                >
          <span style={{ width: 18, height: 18, display: "grid", placeItems: "center", borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)" }}>
            🖼️
          </span>
                    <span style={{ fontSize: 12, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.name}
          </span>
                </TreeRow>
            );
        }

        // child dirs
        for (const k of dirs) {
            const child = n.dirs[k];
            const childPath = path ? `${path}/${k}` : k;
            rows.push(render(child, childPath, depth + 1));
        }

        return rows;
    };

    return (
        <div style={{ padding: 8 }}>
            {render(root, "", 0)}
        </div>
    );
}

/* ------------------------------- Main ProductManager ------------------------------- */
export default function ProductManager({ open, onClose }) {
    const [dbTick, setDbTick] = useState(0);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState(null);
    const [draft, setDraft] = useState(null);

    const [dirty, setDirty] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const saveTimer = useRef(0);

    // Important: default to DISK mode in-app if fs is available
    const [picMode, setPicMode] = useState(() => (hasFsPictures() ? "disk" : "bundled"));
    const [diskRoot, setDiskRoot] = useState(() => "C:\\Users\\Fallore\\Desktop\\Mr. Smith\\Development\\mr3d\\src\\data\\products\\productPictures");
    const [picSearch, setPicSearch] = useState("");
    const [selectedPics, setSelectedPics] = useState(() => new Set());

    const bundledIndex = useMemo(() => buildBundledProductPicturesIndex(), [dbTick]);
    const diskIndex = useMemo(() => (picMode === "disk" ? buildDiskProductPicturesIndex(diskRoot) : null), [picMode, diskRoot, dbTick]);

    const products = useMemo(() => listProducts(), [dbTick, open]);
    const categories = useMemo(() => listCategories(), [dbTick, open]);

    useEffect(() => {
        const p = products.find((x) => x.id === selectedId) || null;
        setDraft(p ? { ...p } : null);
        setDirty(false);
    }, [selectedId, products]);

    useEffect(() => {
        if (!dirty || !draft) return;
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
            upsertProduct(draft);
            setDbTick((x) => x + 1);
            setDirty(false);
            setLastSavedAt(new Date());
        }, 650);
        return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
    }, [dirty, draft]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const filteredProducts = useMemo(() => {
        const q = String(search || "").trim().toLowerCase();
        if (!q) return products;
        return products.filter((p) => `${p.name} ${p.category} ${p.make} ${p.model}`.toLowerCase().includes(q));
    }, [products, search]);

    const rootNode = (picMode === "disk" && diskIndex?.root) ? diskIndex.root : bundledIndex.root;

    const markDirty = () => setDirty(true);

    const patchDraft = (patch) => {
        setDraft((d) => ({ ...(d || {}), ...(patch || {}) }));
        setDirty(true);
    };

    const startNew = () => {
        const id = uuid();
        const category = categories[0] || "AV";
        const make = listMakes(category)[0] || "Generic";
        const model = listModels(category, make)[0] || "Default";
        const p = {
            id,
            name: "New Product",
            category, make, model,
            typeTags: [],
            dims: { w: 0, h: 0, l: 0 },
            weight: 0,
            description: "",
            image: "",
            images: [],
            rackU: null,
        };
        upsertProduct(p);
        setDbTick((x) => x + 1);
        setSelectedId(id);
    };

    const doExport = () => {
        const blob = exportProductsBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `products-db-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const togglePicSelect = (ref, additive) => {
        setSelectedPics((prev) => {
            const next = additive ? new Set(prev) : new Set();
            next.has(ref) ? next.delete(ref) : next.add(ref);
            return next;
        });
    };

    const addToProduct = (ref) => {
        if (!draft) return;
        setDraft((d) => {
            const cur = Array.isArray(d?.images) ? d.images : (d?.image ? [d.image] : []);
            const next = [...cur, ref];
            return { ...d, images: next, image: next[0] || "" };
        });
        markDirty();
    };

    if (!open) return null;

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1050,
                display: "grid",
                placeItems: "center",
                background: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(6px)",
                color: "#fff",
            }}
            onMouseDown={(e) => { e.stopPropagation(); }}
            onPointerDown={(e) => { e.stopPropagation(); }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        >
            <div
                style={{
                    width: "min(1680px, 96vw)",
                    height: "min(920px, 92vh)",
                    borderRadius: 20,
                    overflow: "hidden",
                    background: "radial-gradient(1200px 800px at 20% 0%, #15203a, #0b1020)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    boxShadow: "0 40px 120px rgba(0,0,0,0.75)",
                    display: "grid",
                    gridTemplateRows: "auto 1fr",
                }}
            >
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
                    <div style={{ fontWeight: 950, letterSpacing: 0.3 }}>Product Catalogue</div>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>
                        {dirty ? "Unsaved changes…" : (lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : "Ready")}
                    </div>

                    <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                        <Btn onClick={startNew}>+ New</Btn>
                        <Btn onClick={doExport}>Export</Btn>

                        <label style={{ display: "inline-flex", cursor: "pointer" }}>
                            <input
                                type="file"
                                accept="application/json"
                                style={{ display: "none" }}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    e.target.value = "";
                                    if (f) importProductsFile(f).then(() => { setDbTick((x) => x + 1); setSelectedId(null); });
                                }}
                            />
                            <span style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)" }}>
                Import (Replace)
              </span>
                        </label>

                        <label style={{ display: "inline-flex", cursor: "pointer" }}>
                            <input
                                type="file"
                                accept="application/json"
                                style={{ display: "none" }}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    e.target.value = "";
                                    if (f) mergeProductsFile(f).then(() => setDbTick((x) => x + 1));
                                }}
                            />
                            <span style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)" }}>
                Merge Import
              </span>
                        </label>

                        <Btn onClick={onClose}>Close</Btn>
                    </div>
                </div>

                {/* 3-panel body */}
                <div style={{ padding: 12, display: "grid", gap: 12, gridTemplateColumns: "420px 1fr 420px", minHeight: 0 }}>
                    {/* Left */}
                    <Glass style={{ padding: 12, display: "grid", gridTemplateRows: "auto auto 1fr", minHeight: 0 }}>
                        <Title>Catalogue</Title>
                        <div style={{ marginTop: 10 }}><Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>

                        <div style={{ marginTop: 10, overflowY: "auto" }}>
                            {filteredProducts.map((p) => {
                                const cover = p.image || (Array.isArray(p.images) ? p.images[0] : "");
                                const url = resolvePictureRef(cover, bundledIndex, diskIndex) || cover;
                                const isSel = p.id === selectedId;
                                return (
                                    <div
                                        key={p.id}
                                        onClick={() => setSelectedId(p.id)}
                                        style={{
                                            display: "grid", gridTemplateColumns: "56px 1fr", gap: 10,
                                            padding: 10, borderRadius: 14, cursor: "pointer",
                                            border: isSel ? "1px solid rgba(124,255,255,0.30)" : "1px solid rgba(255,255,255,0.10)",
                                            background: isSel ? "rgba(124,255,255,0.08)" : "rgba(255,255,255,0.04)",
                                            marginBottom: 10,
                                        }}
                                    >
                                        <div style={{ width: 56, height: 56, borderRadius: 12, overflow: "hidden", background: "rgba(0,0,0,0.2)" }}>
                                            {url ? <img alt="" src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name || "Untitled"}</div>
                                            <div style={{ fontSize: 12, opacity: 0.78, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {p.category} / {p.make} / {p.model}
                                            </div>
                                            <div style={{ fontSize: 11, opacity: 0.65 }}>
                                                {(Array.isArray(p.images) ? p.images.length : (p.image ? 1 : 0))} image(s)
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            {!filteredProducts.length && <div style={{ opacity: 0.7, padding: 10 }}>No products.</div>}
                        </div>
                    </Glass>

                    {/* Middle */}
                    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 12, minHeight: 0 }}>
                        {draft ? (
                            <>
                                <Glass style={{ padding: 12, display: "grid", gap: 10 }}>
                                    <Title>Details</Title>

                                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Name</div>
                                            <Input value={draft.name || ""} onChange={(e) => patchDraft({ name: e.target.value })} />
                                        </label>

                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Rack U (optional)</div>
                                            <Input
                                                type="number" min="1" max="5"
                                                value={draft.rackU ?? ""}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    patchDraft({ rackU: v === "" ? null : clamp(Number(v) || 1, 1, 5) });
                                                }}
                                            />
                                        </label>
                                    </div>

                                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr" }}>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Category</div>
                                            <select
                                                value={draft.category || "AV"}
                                                onChange={(e) => { ensureCategory(e.target.value); patchDraft({ category: e.target.value }); }}
                                                style={{ padding: 8, borderRadius: 10, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" }}
                                            >
                                                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </label>

                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Make</div>
                                            <Input value={draft.make || ""} onChange={(e) => { ensureMake(draft.category || "AV", e.target.value || "Generic"); patchDraft({ make: e.target.value }); }} />
                                        </label>

                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Model</div>
                                            <Input value={draft.model || ""} onChange={(e) => { ensureModel(draft.category || "AV", draft.make || "Generic", e.target.value || "Default"); patchDraft({ model: e.target.value }); }} />
                                        </label>
                                    </div>

                                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Width</div>
                                            <Input type="number" value={draft?.dims?.w ?? 0} onChange={(e) => patchDraft({ dims: { ...(draft.dims || {}), w: Number(e.target.value) || 0 } })} />
                                        </label>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Height</div>
                                            <Input type="number" value={draft?.dims?.h ?? 0} onChange={(e) => patchDraft({ dims: { ...(draft.dims || {}), h: Number(e.target.value) || 0 } })} />
                                        </label>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Length</div>
                                            <Input type="number" value={draft?.dims?.l ?? 0} onChange={(e) => patchDraft({ dims: { ...(draft.dims || {}), l: Number(e.target.value) || 0 } })} />
                                        </label>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Weight</div>
                                            <Input type="number" value={draft.weight ?? 0} onChange={(e) => patchDraft({ weight: Number(e.target.value) || 0 })} />
                                        </label>
                                    </div>

                                    <label style={{ display: "grid", gap: 6 }}>
                                        <div style={{ fontSize: 12, opacity: 0.85 }}>Description</div>
                                        <textarea
                                            value={draft.description || ""}
                                            onChange={(e) => patchDraft({ description: e.target.value })}
                                            style={{
                                                width: "100%", minHeight: 90, padding: 10, borderRadius: 12,
                                                background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.10)", color: "#fff",
                                                resize: "vertical",
                                            }}
                                        />
                                    </label>

                                    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                                        <Btn onClick={() => { upsertProduct(draft); setDbTick((x) => x + 1); setDirty(false); setLastSavedAt(new Date()); }}>Save now</Btn>
                                        <Btn onClick={() => { if (!window.confirm("Delete this product?")) return; deleteProduct(draft.id); setDbTick((x) => x + 1); setSelectedId(null); }}>Delete</Btn>
                                    </div>
                                </Glass>

                                <ImagesEditor draft={draft} setDraft={setDraft} bundledIndex={bundledIndex} diskIndex={diskIndex} markDirty={markDirty} />
                            </>
                        ) : (
                            <Glass style={{ padding: 16, display: "grid", placeItems: "center", minHeight: 0 }}>
                                <div style={{ opacity: 0.8 }}>Select a product to edit.</div>
                            </Glass>
                        )}
                    </div>

                    {/* Right */}
                    <Glass style={{ padding: 12, display: "grid", gridTemplateRows: "auto auto auto 1fr auto", minHeight: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <Title>Product Pictures</Title>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <select
                                    value={picMode}
                                    onChange={(e) => { setPicMode(e.target.value); setSelectedPics(new Set()); }}
                                    style={{ padding: 8, borderRadius: 10, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" }}
                                >
                                    <option value="disk" disabled={!hasFsPictures()}>Disk</option>
                                    <option value="bundled">Bundled</option>
                                </select>
                                <Btn onClick={() => setDbTick((x) => x + 1)}>Refresh</Btn>
                            </div>
                        </div>

                        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
                            {picMode === "disk"
                                ? `Disk: ${diskIndex?.count ?? 0} images`
                                : `Bundled: ${bundledIndex?.count ?? 0} images`}
                            {(picMode === "bundled" && bundledIndex?.error) ? ` • ${bundledIndex.error}` : ""}
                        </div>

                        {picMode === "disk" && (
                            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                                <div style={{ fontSize: 12, opacity: 0.85 }}>Root folder</div>
                                <Input value={diskRoot} onChange={(e) => setDiskRoot(e.target.value)} />
                            </div>
                        )}

                        <div style={{ display: "grid", gap: 10, marginTop: 10, minHeight: 0 }}>
                            <Input placeholder="Search folders/files…" value={picSearch} onChange={(e) => setPicSearch(e.target.value)} />

                            <div style={{ overflowY: "auto", borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", minHeight: 0 }}>
                                <FolderFileTree
                                    root={rootNode}
                                    search={picSearch}
                                    selectedRefs={selectedPics}
                                    onToggleSelect={(ref, add) => togglePicSelect(ref, add)}
                                    onAddToProduct={(ref) => addToProduct(ref)}
                                />
                            </div>
                        </div>

                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                            Tip: Ctrl/Cmd select multiple and drag into the Images panel. Double-click a file to add instantly.
                        </div>
                    </Glass>
                </div>
            </div>
        </div>
    );
}

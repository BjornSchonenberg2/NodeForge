import React, { useMemo, useRef, useState, useEffect } from "react";
import { v4 as uuid } from "uuid";
import {
    listProducts, upsertProduct, deleteProduct,
    listCategories, ensureCategory, listMakes, ensureMake,
    listModels, ensureModel, deleteCategory, deleteMake, deleteModel,
    exportProductsBlob, importProductsFile
} from "../data/products/store";
import { Btn, Input, Select } from "../ui/Controls.jsx";

/* ==========================================================
   Minimal icon set (no dependencies)
   ========================================================== */
const Icon = {
    chevronRight: (p) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    ),
    chevronDown: (p) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    ),
    plus: (p) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
    ),
    trash: (p) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m-1 0v14a2 2 0 01-2 2H9a2 2 0 01-2-2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    ),
    factory: (p) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
            <path d="M3 21V8l6 4V8l6 4V8l6 4v9H3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M7 21v-3M11 21v-3M15 21v-3M19 21v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
    ),
    layers: (p) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
            <path d="M12 3l9 5-9 5-9-5 9-5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M21 13l-9 5-9-5M21 18l-9 5-9-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
        </svg>
    ),
    upload: (p) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
            <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    ),
    save: (p) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
            <path d="M17 3H7a2 2 0 00-2 2v14l7-3 7 3V5a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
        </svg>
    ),
};

const IconButton = ({ title, onClick, children }) => (
    <button
        title={title}
        aria-label={title}
        onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
        style={{
            width: 34, height: 34, display: "grid", placeItems: "center",
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.06)", color: "#fff", cursor: "pointer"
        }}
    >
        {children}
    </button>
);

/* ==========================================================
   Inline Dialogs (no window.prompt/confirm)
   ========================================================== */
function DialogBase({ title, children, onCancel }) {
    return (
        <div
            style={{ position: "fixed", inset: 0, zIndex: 1100, display: "grid", placeItems: "center" }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
            <div style={{
                position: "relative",
                width: 520,
                background: "linear-gradient(180deg, #0f1426, #0b1021)",
                border: "1px solid rgba(255,255,255,0.14)", borderRadius: 16, color: "#fff",
                boxShadow: "0 24px 80px rgba(0,0,0,0.55)", padding: 16, display: "grid", gap: 12
            }}>
                <div style={{ fontWeight: 900, letterSpacing: 0.3 }}>{title}</div>
                {children}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Btn onClick={onCancel}>Cancel</Btn>
                </div>
            </div>
        </div>
    );
}

function NameDialog({ title, label = "Name", initial = "", onSubmit, onCancel }) {
    const [val, setVal] = useState(initial);
    return (
        <DialogBase title={title} onCancel={onCancel}>
            <label>
                {label}
                <Input autoFocus value={val} onChange={(e) => setVal(e.target.value)} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Btn variant="primary" glow onClick={() => { if (!val.trim()) return; onSubmit(val.trim()); }}>Save</Btn>
            </div>
        </DialogBase>
    );
}

function ConfirmDialog({ title, message, onConfirm, onCancel }) {
    return (
        <DialogBase title={title} onCancel={onCancel}>
            <div style={{ opacity: 0.85 }}>{message}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Btn onClick={onCancel}>Cancel</Btn>
                <Btn variant="primary" glow onClick={onConfirm}>Confirm</Btn>
            </div>
        </DialogBase>
    );
}

/* ==========================================================
   Small UI atoms
   ========================================================== */
const CountBadge = ({ n }) => (
    <span style={{ fontSize: 11, opacity: 0.9, padding: "2px 6px", borderRadius: 999, background: "rgba(255,255,255,0.14)" }}>{n}</span>
);

const Thumb = ({ src, size = 72 }) => (
    src ? (
        <img alt="" src={src} style={{ width: size, height: size, objectFit: "cover", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)" }}/>
    ) : (
        <div style={{ width: size, height: size, borderRadius: 12, background: "rgba(255,255,255,0.06)", display: "grid", placeItems: "center", fontSize: 12, opacity: 0.8 }}>No image</div>
    )
);

const Row = ({ leading, label, sublabel, right, onToggle, open }) => (
    <div
        onClick={onToggle}
        style={{
            display: "flex", alignItems: "center", gap: 10, padding: 12,
            background: open ? "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))" : "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, cursor: "pointer"
        }}
    >
    <span style={{ width: 28, height: 28, display: "grid", placeItems: "center",
        borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.06)", color: "#fff" }}>
      {open ? <Icon.chevronDown/> : <Icon.chevronRight/>}
    </span>
        {leading}
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
            {sublabel && <div style={{ fontSize: 12, opacity: 0.8 }}>{sublabel}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>{right}</div>
    </div>
);

/* ==========================================================
   FS helpers for saving images locally (Electron/Node)
   ========================================================== */
function hasFs() { try { return !!(window?.require?.("fs")); } catch { return false; } }
async function saveImageFileToProject(file) {
    if (!hasFs()) return null;
    const fs = window.require("fs");
    const path = window.require("path");
    const base = process.cwd();
    const dir = path.join(base, "data", "media", "products");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const namePart = (file.name || "").toLowerCase();
    const typePart = (file.type || "").toLowerCase();
    const extFromName = namePart.match(/\.[a-z0-9]+$/i)?.[0];
    const mimeToExt = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
    const ext = extFromName || mimeToExt[typePart] || ".png";
    const fname = `${uuid()}${ext}`;
    const fpath = path.join(dir, fname);
    const buf = await file.arrayBuffer();
    const BufferCtor = window.require?.("buffer")?.Buffer || Buffer;
    const nodeBuf = BufferCtor.from(new Uint8Array(buf));
    fs.writeFileSync(fpath, nodeBuf);
    const fileUrl = `file://${fpath.replace(/\\/g, "/")}`;
    const rel = `data/media/products/${fname}`;
    return { fileUrl, rel };
}

/* ==========================================================
   ProductManager (full rewrite w/ Rack U + inline dialogs + fs image save)
   ========================================================== */
export default function ProductManager({ open, onClose }) {
    const [dbVersion, setDbVersion] = useState(0);
    const [filter, setFilter] = useState("");
    const [selId, setSelId] = useState(null);
    const [dlg, setDlg] = useState(null); // { type: 'name' | 'confirm', ... }

    // Expansion state (Category -> Make -> Model)
    const [openCats, setOpenCats] = useState(new Set());
    const [openMakes, setOpenMakes] = useState(new Map()); // cat -> Set(makes)
    const [openModels, setOpenModels] = useState(new Map()); // `${cat}|||${make}` -> Set(models)

    // Guard the global canvas drop handlers while the modal is open
    useEffect(() => {
        if (!open) return;
        window.__UI_DROP_GUARD = true;
        return () => { delete window.__UI_DROP_GUARD; };
    }, [open]);

    const categories = useMemo(() => listCategories(), [dbVersion, open]);
    const allProducts = useMemo(() => listProducts(), [dbVersion]);
    const selected = useMemo(() => allProducts.find(p => p.id === selId) || null, [selId, allProducts]);

    const [draft, setDraft] = useState(null);
    useEffect(() => {
        setDraft(selected ? { ...selected } : null);
    }, [selected]);


    const subMakes = useMemo(() => listMakes(draft?.category || ""), [dbVersion, draft?.category, open]);
    const subModels = useMemo(() => listModels(draft?.category || "", draft?.make || ""), [dbVersion, draft?.category, draft?.make, open]);

    /* ---------- image picker & drop zone ---------- */
    const dropRef = useRef(null);
    const fileRef = useRef(null);

    const handleFile = async (file) => {
        if (!file) return;
        // Try to save to project via fs; fallback to dataURL
        const saved = await saveImageFileToProject(file).catch(() => null);
        if (saved) {
            setDraft((d) => ({ ...(d || { id: uuid() }), image: saved.fileUrl }));
        } else {
            const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
            setDraft((d) => ({ ...(d || { id: uuid() }), image: data }));
        }
    };
// Refresh lists every time the Product Manager is (re)opened
    useEffect(() => {
        if (open) setDbVersion(v => v + 1);
    }, [open]);

    useEffect(() => {
        if (!dropRef.current) return;
        const el = dropRef.current;
        const over = (e) => { e.preventDefault(); e.stopPropagation(); el.dataset.hl = "1"; };
        const leave = (e) => { e.preventDefault(); e.stopPropagation(); el.dataset.hl = ""; };
        const drop = async (e) => {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); el.dataset.hl = "";
            const file = e.dataTransfer?.files?.[0]; if (!file) return; if (!/^image\//.test(file.type)) return;
            await handleFile(file);
        };
        el.addEventListener("dragover", over);
        el.addEventListener("dragleave", leave);
        el.addEventListener("drop", drop);
        return () => { el.removeEventListener("dragover", over); el.removeEventListener("dragleave", leave); el.removeEventListener("drop", drop); };
    }, []);

    /* ---------- CRUD ---------- */
    const startNew = () => {
        const id = uuid();
        setSelId(id);
        setDraft({ id, name: "", category: categories[0] || "AV", make: "Generic", model: "Default", rackU: 1, typeTags: [], dims: { w: 0, h: 0, l: 0 }, weight: 0, description: "", image: "" });
    };
    const save = () => {
        if (!draft) return;
        upsertProduct({ ...draft, name: String(draft.name || "").trim(), rackU: draft.rackU ? Number(draft.rackU) : null });
        setDbVersion(v => v + 1);
    };
    const remove = () => {
        if (!selected) return;
        setDlg({ type: "confirm", title: "Delete product", message: `Delete "${selected.name || selected.id}"? This cannot be undone.`, onConfirm: () => {
                deleteProduct(selected.id); setSelId(null); setDraft(null); setDbVersion(v => v + 1); setDlg(null);
            }, onCancel: () => setDlg(null) });
    };

    // Add entity dialogs
    const addCategory = () => setDlg({ type: "name", title: "Add Category", label: "Category name", onSubmit: (val) => { ensureCategory(val); setDbVersion(v => v + 1); setDlg(null); } });
    const addMake = (cat) => setDlg({ type: "name", title: `Add Make under ${cat}`, label: "Make name", onSubmit: (val) => { ensureMake(cat, val); setDbVersion(v => v + 1); setDlg(null); } });
    const addModel = (cat, make) => setDlg({ type: "name", title: `Add Model under ${cat} / ${make}`, label: "Model name", onSubmit: (val) => { ensureModel(cat, make, val); setDbVersion(v => v + 1); setDlg(null); } });

    // destructive: cascade delete dialogs
    const removeCategoryCascade = (cat) => setDlg({ type: "confirm", title: "Delete category", message: `Delete category "${cat}" and ALL its products?`, onConfirm: () => { deleteCategory(cat); setDbVersion(v => v + 1); if (draft?.category === cat) { setSelId(null); setDraft(null); } setDlg(null); }, onCancel: () => setDlg(null) });
    const removeMakeCascade = (cat, make) => setDlg({ type: "confirm", title: "Delete make", message: `Delete make "${make}" under ${cat} and ALL its products?`, onConfirm: () => { deleteMake(cat, make); setDbVersion(v => v + 1); if (draft?.category === cat && draft?.make === make) { setSelId(null); setDraft(null); } setDlg(null); }, onCancel: () => setDlg(null) });
    const removeModelCascade = (cat, make, model) => setDlg({ type: "confirm", title: "Delete model", message: `Delete model "${model}" under ${cat} / ${make} and ALL its products?`, onConfirm: () => { deleteModel(cat, make, model); setDbVersion(v => v + 1); if (draft?.category === cat && draft?.make === make && draft?.model === model) { setSelId(null); setDraft(null); } setDlg(null); }, onCancel: () => setDlg(null) });

    // filtering (auto-expand when filtering)
    const f = filter.toLowerCase().trim();
    const matches = (p) => !f || [p.name, p.category, p.make, p.model, p.description].some(x => (x || "").toLowerCase().includes(f));
    useEffect(() => {
        if (!f) return; // on filter, open everything
        const all = new Set(listCategories());
        setOpenCats(all);
        const mk = new Map();
        all.forEach(cat => mk.set(cat, new Set(listMakes(cat))));
        setOpenMakes(mk);
        const mdl = new Map();
        all.forEach(cat => {
            const makes = listMakes(cat);
            makes.forEach(make => mdl.set(`${cat}|||${make}`, new Set(listModels(cat, make))));
        });
        setOpenModels(mdl);
    }, [filter]);

    // expansion toggles
    const toggleCat = (cat) => setOpenCats(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });
    const toggleMake = (cat, make) => setOpenMakes(prev => { const n = new Map(prev); const s = new Set(n.get(cat) || []); s.has(make) ? s.delete(make) : s.add(make); n.set(cat, s); return n; });
    const toggleModel = (cat, make, model) => setOpenModels(prev => { const key = `${cat}|||${make}`; const n = new Map(prev); const s = new Set(n.get(key) || []); s.has(model) ? s.delete(model) : s.add(model); n.set(key, s); return n; });

    if (!open) return null;

    return (
        <div
            data-pm-root
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.68)", display: "grid", placeItems: "center" }}
            onPointerDown={(e) => e.stopPropagation()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
            <div style={{
                width: 1440, maxWidth: "98vw", maxHeight: "92vh",
                background: "linear-gradient(180deg, #0e1322 0%, #0b1020 100%)",
                border: "1px solid rgba(255,255,255,0.14)", borderRadius: 20, overflow: "hidden", color: "#fff",
                display: "grid", gridTemplateColumns: "500px 1fr", boxShadow: "0 36px 140px rgba(0,0,0,0.55)"
            }}>
                {/* Header */}
                <div style={{
                    gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: 16, borderBottom: "1px solid rgba(255,255,255,0.12)",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))", backdropFilter: "blur(16px)"
                }}>
                    <div style={{ fontWeight: 900, letterSpacing: 0.4 }}>Product Management</div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Btn onClick={() => {
                            const blob = exportProductsBlob(); const url = URL.createObjectURL(blob);
                            const a = document.createElement("a"); a.href = url; a.download = "products.db.json";
                            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                        }}><Icon.upload style={{ marginRight: 6 }}/>Export</Btn>
                        <label>
                            <input type="file" accept=".json" style={{ display: "none" }} onChange={async (e) => {
                                const f = e.target.files?.[0]; e.target.value = "";
                                if (!f) return; try { await importProductsFile(f); setDbVersion(v => v + 1); }
                                catch (err) { /* optional: show inline error */ }
                            }}/>
                            <Btn><Icon.upload style={{ transform: "rotate(180deg)", marginRight: 6 }}/>Import</Btn>
                        </label>
                        <Btn onClick={onClose}>Close</Btn>
                    </div>
                </div>

                {/* LEFT: Tree */}
                <div style={{ overflowY: "auto", padding: 16, borderRight: "1px solid rgba(255,255,255,0.12)" }} className="glass-scroll">
                    <div style={{ display: "grid", gap: 10 }}>
                        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                        <Btn variant="primary" glow onClick={startNew}><Icon.plus style={{ marginRight: 6 }}/>New Product</Btn>
                    </div>

                    <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                        {categories.map((cat) => {
                            const makes = listMakes(cat);
                            const catProducts = listProducts(cat).filter(matches);
                            if (f && !catProducts.length) return null;
                            const catOpen = openCats.has(cat);

                            return (
                                <div key={cat} style={{ display: "grid", gap: 8 }}>
                                    <Row
                                        label={cat}
                                        sublabel={`${catProducts.length} product${catProducts.length !== 1 ? "s" : ""}`}
                                        onToggle={() => toggleCat(cat)}
                                        open={catOpen}
                                        right={
                                            <>
                                                <CountBadge n={catProducts.length} />
                                                <IconButton title="Add make" onClick={() => addMake(cat)}><Icon.factory/></IconButton>
                                                <IconButton title="Add product" onClick={() => { ensureCategory(cat); startNew(); setDraft(d => d ? { ...d, category: cat, make: "Generic", model: "Default" } : d); }}><Icon.plus/></IconButton>
                                                <IconButton title="Delete category" onClick={() => removeCategoryCascade(cat)}><Icon.trash/></IconButton>
                                            </>
                                        }
                                    />

                                    {catOpen && (
                                        <div style={{ display: "grid", gap: 8, marginLeft: 10, paddingLeft: 10, borderLeft: "1px dashed rgba(255,255,255,0.18)" }}>
                                            {makes.map(make => {
                                                const models = listModels(cat, make);
                                                const makeProducts = listProducts(cat, make).filter(matches);
                                                if (f && !makeProducts.length) return null;
                                                const mkOpen = (openMakes.get(cat) || new Set()).has(make);
                                                return (
                                                    <div key={make} style={{ display: "grid", gap: 8 }}>
                                                        <Row
                                                            label={`${cat} / ${make}`}
                                                            sublabel={`${makeProducts.length} item${makeProducts.length !== 1 ? "s" : ""}`}
                                                            onToggle={() => toggleMake(cat, make)}
                                                            open={mkOpen}
                                                            right={
                                                                <>
                                                                    <CountBadge n={makeProducts.length} />
                                                                    <IconButton title="Add model" onClick={() => addModel(cat, make)}><Icon.layers/></IconButton>
                                                                    <IconButton title="Add product" onClick={() => { startNew(); setDraft(d => d ? { ...d, category: cat, make, model: "Default" } : d); }}><Icon.plus/></IconButton>
                                                                    <IconButton title="Delete make" onClick={() => removeMakeCascade(cat, make)}><Icon.trash/></IconButton>
                                                                </>
                                                            }
                                                        />

                                                        {mkOpen && (
                                                            <div style={{ display: "grid", gap: 8, marginLeft: 10, paddingLeft: 10, borderLeft: "1px dashed rgba(255,255,255,0.18)" }}>
                                                                {models.map(model => {
                                                                    const prods = listProducts(cat, make, model).filter(matches);
                                                                    if (f && !prods.length) return null;
                                                                    const key = `${cat}|||${make}`;
                                                                    const mdOpen = (openModels.get(key) || new Set()).has(model);
                                                                    return (
                                                                        <div key={model} style={{ display: "grid", gap: 8 }}>
                                                                            <Row
                                                                                label={`${cat} / ${make} / ${model}`}
                                                                                sublabel={`${prods.length} product${prods.length !== 1 ? "s" : ""}`}
                                                                                onToggle={() => toggleModel(cat, make, model)}
                                                                                open={mdOpen}
                                                                                right={
                                                                                    <>
                                                                                        <CountBadge n={prods.length} />
                                                                                        <IconButton title="Add product" onClick={() => { startNew(); setDraft(d => d ? { ...d, category: cat, make, model } : d); }}><Icon.plus/></IconButton>
                                                                                        <IconButton title="Delete model" onClick={() => removeModelCascade(cat, make, model)}><Icon.trash/></IconButton>
                                                                                    </>
                                                                                }
                                                                            />

                                                                            {mdOpen && (
                                                                                <div style={{ display: "grid", gap: 8, marginLeft: 12, paddingLeft: 12, borderLeft: "1px dashed rgba(255,255,255,0.18)" }}>
                                                                                    {prods.map(p => (
                                                                                        <div
                                                                                            key={p.id}
                                                                                            onClick={() => setSelId(p.id)}
                                                                                            style={{
                                                                                                display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center",
                                                                                                padding: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                                                                                                background: selId === p.id ? "rgba(0,225,255,0.12)" : "rgba(255,255,255,0.04)", cursor: "pointer"
                                                                                            }}
                                                                                        >
                                                                                            <Thumb src={p.image} size={60} />
                                                                                            <div style={{ minWidth: 0 }}>
                                                                                                <div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name || "(unnamed)"}</div>
                                                                                                <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.category} › {p.make} › {p.model}{typeof p.rackU === "number" ? ` • ${p.rackU}U` : ""}</div>
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                    {!prods.length && <div style={{ opacity: 0.7, padding: "4px 2px" }}>No products.</div>}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {!categories.length && <div style={{ opacity: 0.7 }}>No categories yet.</div>}
                    </div>
                </div>

                {/* RIGHT: Editor */}
                <div style={{ overflowY: "auto", padding: 16 }} className="glass-scroll">
                    {!draft ? (
                        <div style={{ opacity: 0.8 }}>Select a product or create a new one.</div>
                    ) : (
                        <div style={{ display: "grid", gap: 14 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "start" }}>
                                <div
                                    ref={dropRef}
                                    data-hl=""
                                    onClick={() => fileRef.current?.click()}
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    style={{
                                        width: 220, height: 220, borderRadius: 16, overflow: "hidden",
                                        border: "2px dashed rgba(255,255,255,0.18)",
                                        outline: dropRef.current?.dataset?.hl ? "2px solid #50e3c2" : "none",
                                        display: "grid", placeItems: "center", background: "rgba(255,255,255,0.04)", cursor: "pointer"
                                    }}
                                    title="Drop or click to select image"
                                >
                                    {draft.image ? (
                                        <img alt="" src={draft.image} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                                    ) : (
                                        <div style={{ textAlign: "center", opacity: 0.8 }}>
                                            Drop image or click to upload
                                            <div style={{ fontSize: 11, opacity: 0.7 }}>PNG / JPG / WEBP</div>
                                        </div>
                                    )}
                                    <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; await handleFile(f); }} />
                                </div>

                                <div style={{ display: "grid", gap: 10 }}>
                                    <label>
                                        Name
                                        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                                    </label>

                                    {/* Reassignment controls */}
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                                        <label>
                                            Category
                                            <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value, make: "", model: "" })}>
                                                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                            </Select>
                                        </label>
                                        <IconButton title="Add category" onClick={addCategory}><Icon.plus/></IconButton>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                                        <label>
                                            Make
                                            <Select value={draft.make || ""} onChange={(e) => setDraft({ ...draft, make: e.target.value, model: "" })}>
                                                <option value="">(select)</option>
                                                {subMakes.map(m => <option key={m} value={m}>{m}</option>)}
                                            </Select>
                                        </label>
                                        <IconButton title="Add make" onClick={() => addMake(draft.category)}><Icon.factory/></IconButton>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                                        <label>
                                            Model
                                            <Select value={draft.model || ""} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
                                                <option value="">(select)</option>
                                                {subModels.map(m => <option key={m} value={m}>{m}</option>)}
                                            </Select>
                                        </label>
                                        <IconButton title="Add model" onClick={() => addModel(draft.category, draft.make)}><Icon.layers/></IconButton>
                                    </div>

                                    {/* Rack U selector */}
                                    <label>
                                        Rack U
                                        <Select value={String(draft.rackU ?? "")} onChange={(e) => setDraft({ ...draft, rackU: e.target.value ? Number(e.target.value) : null })}>
                                            <option value="">(not set)</option>
                                            <option value="1">1U</option>
                                            <option value="2">2U</option>
                                            <option value="3">3U</option>
                                            <option value="4">4U</option>
                                            <option value="5">5U</option>
                                        </Select>
                                    </label>

                                    {/* Type tags */}
                                    <div>
                                        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>Type tags (AV, Lighting, …)</div>
                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                            {(draft.typeTags || []).map(t => (
                                                <span key={t} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", padding: "3px 6px", borderRadius: 6, display: "inline-flex", gap: 6, alignItems: "center" }}>
                          {t}
                                                    <a style={{ cursor: "pointer", opacity: 0.8 }} onClick={() => setDraft(d => ({ ...d, typeTags: (d.typeTags || []).filter(x => x !== t) }))}>✕</a>
                        </span>
                                            ))}
                                            <IconButton title="Add tag" onClick={() => { const v = prompt("Add type tag:"); if (!v) return; setDraft(d => ({ ...d, typeTags: Array.from(new Set([...(d.typeTags || []), v])) })); }}><Icon.plus/></IconButton>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Dims / weight */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                                <label style={{ fontSize: 12 }}>
                                    Width
                                    <Input type="number" step="0.01" value={draft.dims?.w ?? 0} onChange={(e) => setDraft({ ...draft, dims: { ...(draft.dims || {}), w: Number(e.target.value || 0) } })} style={{ height: 32, padding: "4px 8px", fontSize: 13 }} />
                                </label>
                                <label style={{ fontSize: 12 }}>
                                    Height
                                    <Input type="number" step="0.01" value={draft.dims?.h ?? 0} onChange={(e) => setDraft({ ...draft, dims: { ...(draft.dims || {}), h: Number(e.target.value || 0) } })} style={{ height: 32, padding: "4px 8px", fontSize: 13 }} />
                                </label>
                                <label style={{ fontSize: 12 }}>
                                    Length
                                    <Input type="number" step="0.01" value={draft.dims?.l ?? 0} onChange={(e) => setDraft({ ...draft, dims: { ...(draft.dims || {}), l: Number(e.target.value || 0) } })} style={{ height: 32, padding: "4px 8px", fontSize: 13 }} />
                                </label>
                                <label style={{ fontSize: 12 }}>
                                    Weight
                                    <Input type="number" step="0.01" value={draft.weight ?? 0} onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value || 0) })} style={{ height: 32, padding: "4px 8px", fontSize: 13 }} />
                                </label>
                            </div>

                            <label> Description
                                <textarea
                                    value={draft.description || ""}
                                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                                    style={{ width: "100%", minHeight: 140, resize: "vertical", background: "#121a2d", color: "#fff", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, padding: 10, fontFamily: "inherit", fontSize: 14 }}
                                />
                            </label>

                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <Btn onClick={save} variant="primary" glow><Icon.save style={{ marginRight: 6 }}/>Save</Btn>
                                    {selected && <Btn onClick={remove}><Icon.trash style={{ marginRight: 6 }}/>Delete</Btn>}
                                </div>
                                <div style={{ opacity: 0.8, fontSize: 12 }}>DB: localStorage <code>epic3d.products.v2</code> (or <code>data/products.db.json</code> in Electron).</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Inline dialogs */}
            {dlg?.type === "name" && (
                <NameDialog title={dlg.title} label={dlg.label} onSubmit={dlg.onSubmit} onCancel={() => setDlg(null)} />
            )}
            {dlg?.type === "confirm" && (
                <ConfirmDialog title={dlg.title} message={dlg.message} onConfirm={dlg.onConfirm} onCancel={dlg.onCancel} />
            )}
        </div>
    );
}

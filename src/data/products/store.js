// src/data/products/store.js
// ---------------------------------------------------------------------------
// Inventory Store (schema v3, stored under the old v2 key for compatibility)
// - Products: Category -> Make -> Model -> Products (with dims, weight, rackU)
// - Racks: name, dims, items[{ productId }]
// - Persists to localStorage (browser) or ./data/products.db.json (Electron)
// - Migrates old v1/v2 shapes into v3 cleanly
// ---------------------------------------------------------------------------

import { v4 as uuid } from "uuid";

const STORE_KEY = "epic3d.products.v2"; // keep the old key so your UI text stays true
const DEFAULT_CATEGORIES = ["AV", "Lighting", "Rigging", "Network"];

/* ------------------------------- FS helpers ------------------------------- */
function hasFs() { try { return !!(window?.require?.("fs")); } catch { return false; } }
function fsApi() {
    const fs = window.require("fs");
    const path = window.require("path");
    const base = process.cwd();
    const dir = path.join(base, "data");
    const file = path.join(dir, "products.db.json");
    return { fs, dir, file };
}

/* ----------------------------- base structures ---------------------------- */
const uniq = (arr = []) => Array.from(new Set(arr.filter(Boolean)));
const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
};

function defaultState() {
    return {
        schemaVersion: 3,
        categories: [...DEFAULT_CATEGORIES],
        makes: {},            // { [category]: string[] }
        models: {},           // { [category]: { [make]: string[] } }
        products: [],         // product[]
        racks: [],            // rack[]
    };
}

/* ----------------------------- normalizers/migrations ----------------------------- */
function cleanProduct(p) {
    const ru = p.rackU == null || p.rackU === "" ? null : Math.max(1, Math.min(5, Number(p.rackU)));
    return {
        id: p.id || uuid(),
        name: String(p.name || ""),
        category: String(p.category || "AV"),
        make: String(p.make || "Generic"),
        model: String(p.model || "Default"),
        typeTags: uniq(p.typeTags || []),
        dims: { w: num(p?.dims?.w ?? p.width, 0), h: num(p?.dims?.h ?? p.height, 0), l: num(p?.dims?.l ?? p.length, 0) },
        weight: num(p.weight, 0),
        description: String(p.description || ""),
        image: String(p.image || ""),
        rackU: ru,
    };
}

function cleanRack(r) {
    return {
        id: r.id || uuid(),
        name: String(r.name || "Rack"),
        width: num(r.width, 60),
        height: num(r.height, 200),
        length: num(r.length, 80),
        weight: num(r.weight, 0),
        items: Array.isArray(r.items)
            ? r.items
                .map(it =>
                    it && it.productId
                        ? { productId: String(it.productId), qty: Math.max(1, num(it.qty, 1)) }
                        : null
                )
                .filter(Boolean)
            : [],

    };
}

function normalizeV2toV3(raw) {
    const s = defaultState();
    s.categories = uniq(raw.categories || s.categories);
    s.makes = raw.makes || {};
    s.models = raw.models || {};
    s.products = Array.isArray(raw.products) ? raw.products.map(cleanProduct) : [];
    s.racks = []; // new in v3
    return s;
}

function normalizeLegacyV1(raw) {
    const out = defaultState();
    if (Array.isArray(raw?.categories) && raw.categories.length) out.categories = uniq(raw.categories);
    if (raw?.subcats && typeof raw.subcats === "object") {
        for (const cat of Object.keys(raw.subcats)) {
            out.makes[cat] ||= [];
            if (!out.makes[cat].includes("Generic")) out.makes[cat].push("Generic");
            out.models[cat] ||= {};
            out.models[cat]["Generic"] = uniq([...(out.models[cat]["Generic"] || []), ...raw.subcats[cat]]);
        }
    }
    (raw?.products || []).forEach((p) => {
        const category = p.category || out.categories[0] || "AV";
        const make = p.make || "Generic";
        const model = p.model || p.subcategory || "Default";
        out.categories = uniq([...out.categories, category]);
        out.makes[category] = uniq([...(out.makes[category] || []), make]);
        out.models[category] ||= {};
        out.models[category][make] = uniq([...(out.models[category][make] || []), model]);
        out.products.push(cleanProduct({ ...p, category, make, model }));
    });
    return out;
}

function normalizeOnLoad(raw) {
    if (!raw || typeof raw !== "object") return defaultState();
    if (raw.schemaVersion === 3) {
        const s = { ...defaultState(), ...raw };
        s.categories = uniq(s.categories);
        s.makes ||= {};
        s.models ||= {};
        s.products = Array.isArray(s.products) ? s.products.map(cleanProduct) : [];
        s.racks = Array.isArray(s.racks) ? s.racks.map(cleanRack) : [];
        return s;
    }
    if (raw.schemaVersion === 2) return normalizeV2toV3(raw);
    return normalizeLegacyV1(raw);
}

/* --------------------------------- IO ------------------------------------ */
function read() {
    if (hasFs()) {
        const { fs, dir, file } = fsApi();
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(file)) {
                const seed = defaultState();
                fs.writeFileSync(file, JSON.stringify(seed, null, 2), "utf-8");
                return seed;
            }
            const raw = JSON.parse(fs.readFileSync(file, "utf-8") || "{}");
            return normalizeOnLoad(raw);
        } catch {
            return defaultState();
        }
    } else {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) {
            const seed = defaultState();
            localStorage.setItem(STORE_KEY, JSON.stringify(seed));
            return seed;
        }
        try {
            return normalizeOnLoad(JSON.parse(raw));
        } catch {
            return defaultState();
        }
    }
}

function write(state) {
    const s = normalizeOnLoad(state);
    if (hasFs()) {
        const { fs, dir, file } = fsApi();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(s, null, 2), "utf-8");
    } else {
        localStorage.setItem(STORE_KEY, JSON.stringify(s));
    }
    return s;
}

/* ----------------------------- Product API ------------------------------- */
export function getState() { return read(); }

export function listCategories() { return getState().categories || []; }

export function ensureCategory(cat) {
    const s = read();
    const c = String(cat || "").trim();
    if (!c) return s.categories;
    if (!s.categories.includes(c)) s.categories.push(c);
    s.makes[c] ||= [];
    s.models[c] ||= {};
    write(s);
    return s.categories;
}

export function listMakes(category) { return getState().makes?.[category] || []; }

export function ensureMake(category, make) {
    if (!category) return [];
    const s = read();
    ensureCategory(category);
    const m = String(make || "").trim();
    if (!m) return s.makes[category];
    s.makes[category] ||= [];
    if (!s.makes[category].includes(m)) s.makes[category].push(m);
    s.models[category] ||= {};
    s.models[category][m] ||= [];
    write(s);
    return s.makes[category];
}

export function listModels(category, make) { return getState().models?.[category]?.[make] || []; }

export function ensureModel(category, make, model) {
    if (!category || !make) return [];
    const s = read();
    ensureMake(category, make);
    const md = String(model || "").trim();
    if (!md) return s.models[category][make];
    s.models[category][make] ||= [];
    if (!s.models[category][make].includes(md)) s.models[category][make].push(md);
    write(s);
    return s.models[category][make];
}

export function listProducts(category, make, model) {
    const s = read();
    let arr = s.products || [];
    if (category) arr = arr.filter((p) => p.category === category);
    if (make) arr = arr.filter((p) => p.make === make);
    if (model) arr = arr.filter((p) => p.model === model);
    return arr;
}

export function upsertProduct(p) {
    const s = read();
    const c = p.category || s.categories[0] || "AV";
    const m = p.make || "Generic";
    const md = p.model || "Default";
    ensureModel(c, m, md);

    const clean = cleanProduct({ ...p, category: c, make: m, model: md });
    const i = s.products.findIndex((x) => x.id === clean.id || x.id === p.id);
    if (i >= 0) s.products[i] = clean; else s.products.push(clean);
    write(s);
    return clean;
}

export function getProductById(id) {
    return (getState().products || []).find((p) => p.id === id) || null;
}

export function deleteProduct(id) {
    const s = read();
    s.products = (s.products || []).filter((x) => x.id !== id);
    // also remove from racks
    s.racks = (s.racks || []).map((r) => ({
        ...r,
        items: (r.items || []).filter((i) => i.productId !== id),
    }));
    write(s);
}

export function deleteModel(category, make, model) {
    const s = read();
    if (!s.models?.[category]?.[make]) return;
    const removed = new Set(
        (s.products || [])
            .filter((p) => p.category === category && p.make === make && p.model === model)
            .map((p) => p.id)
    );
    s.products = (s.products || []).filter(
        (p) => !(p.category === category && p.make === make && p.model === model)
    );
    s.models[category][make] = (s.models[category][make] || []).filter((m) => m !== model);
    // purge from racks
    s.racks = (s.racks || []).map((r) => ({
        ...r,
        items: (r.items || []).filter((i) => !removed.has(i.productId)),
    }));
    write(s);
}

export function deleteMake(category, make) {
    const s = read();
    if (!s.makes?.[category]) return;
    const removed = new Set(
        (s.products || []).filter((p) => p.category === category && p.make === make).map((p) => p.id)
    );
    s.products = (s.products || []).filter((p) => !(p.category === category && p.make === make));
    if (s.models?.[category]) delete s.models[category][make];
    s.makes[category] = (s.makes[category] || []).filter((m) => m !== make);
    s.racks = (s.racks || []).map((r) => ({
        ...r,
        items: (r.items || []).filter((i) => !removed.has(i.productId)),
    }));
    write(s);
}

export function deleteCategory(category) {
    const s = read();
    const removed = new Set((s.products || []).filter((p) => p.category === category).map((p) => p.id));
    s.products = (s.products || []).filter((p) => p.category !== category);
    delete s.models[category];
    delete s.makes[category];
    s.categories = (s.categories || []).filter((c) => c !== category);
    s.racks = (s.racks || []).map((r) => ({
        ...r,
        items: (r.items || []).filter((i) => !removed.has(i.productId)),
    }));
    write(s);
}

/* --------------------------------- Racks ---------------------------------- */
export function listRacks() {
    return getState().racks || [];
}

export function getRackById(id) {
    return (getState().racks || []).find((r) => r.id === id) || null;
}

export function upsertRack(rack) {
    const s = read();
    const clean = cleanRack(rack || {});
    const i = s.racks.findIndex((x) => x.id === clean.id || x.id === rack.id);
    if (i >= 0) s.racks[i] = clean; else s.racks.push(clean);
    write(s);
    return clean;
}

export function deleteRack(id) {
    const s = read();
    s.racks = (s.racks || []).filter((r) => r.id !== id);
    write(s);
}

export function addProductToRack(rackId, productId, qty = 1) {
    const s = read();
    const r = (s.racks || []).find(x => x.id === rackId);
    if (!r) return;
    r.items ||= [];
    const ex = r.items.find(i => i.productId === productId);
    if (ex) ex.qty = Math.max(1, num(ex.qty, 1) + num(qty, 1));
    else r.items.push({ productId, qty: Math.max(1, num(qty, 1)) });
    write(s);
}
// --- add to src/data/products/store.js ---

export function setRackItems(rackId, newItems = []) {
    const rack = getRackById(rackId);
    if (!rack) return false;
    const next = { ...rack, items: Array.isArray(newItems) ? newItems : [] };
    upsertRack(next);
    return true;
}

export function moveRackItem(rackId, fromIndex, toIndex) {
    const rack = getRackById(rackId);
    if (!rack) return false;
    const items = Array.from(rack.items || []);
    if (
        fromIndex < 0 ||
        fromIndex >= items.length ||
        toIndex < 0 ||
        toIndex >= items.length
    ) {
        return false;
    }
    const [m] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, m);
    upsertRack({ ...rack, items });
    return true;
}

export function removeProductFromRack(rackId, productId, qty = 1) {
    const s = read();
    const r = (s.racks || []).find(x => x.id === rackId);
    if (!r) return;
    r.items ||= [];
    const ex = r.items.find(i => i.productId === productId);
    if (!ex) return;
    const next = Math.max(0, num(ex.qty, 1) - num(qty, 1));
    if (next <= 0) r.items = r.items.filter(i => i !== ex);
    else ex.qty = next;
    write(s);
}
export function setRackItemQty(rackId, productId, qty) {
    const s = read();
    const r = (s.racks || []).find(x => x.id === rackId);
    if (!r) return;
    r.items ||= [];
    const ex = r.items.find(i => i.productId === productId);
    const q = Math.max(0, num(qty, 0));
    if (!ex && q > 0) r.items.push({ productId, qty: q });
    else if (ex && q <= 0) r.items = r.items.filter(i => i !== ex);
    else if (ex) ex.qty = q;
    write(s);
}


/* ----------------------------- import / export ---------------------------- */
export function exportProductsBlob() {
    const state = read();
    return new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
}

export async function importProductsFile(file) {
    const txt = await file.text();
    const obj = JSON.parse(txt);
    const state = normalizeOnLoad(obj);
    write(state);
    return state;
}

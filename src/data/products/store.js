// src/data/products/store.js
// ---------------------------------------------------------------------------
// Product/Rack inventory store (schema v3 + images)
// Persistence:
//   - Electron/NW (fs available): ./data/products.db.json (sync)
//   - Browser: IndexedDB (async) with an in-memory cache (sync reads)
//
// Why: localStorage is ~5MB and you hit QuotaExceededError when products include
// dataURL images / lots of products. IndexedDB handles much larger data.
//
// Back-compat:
//   - Reads legacy localStorage key "epic3d.products.v2" once, migrates to IDB,
//     and then removes the localStorage entry to stop quota errors.
// ---------------------------------------------------------------------------

import { v4 as uuid } from "uuid";

const STORE_KEY = "epic3d.products.v2"; // legacy key (read-once migration)
const DEFAULT_CATEGORIES = ["AV", "Lighting", "Rigging", "Network"];

// IndexedDB
const IDB_NAME = "epic3d.products.db";
const IDB_VER = 1;
const IDB_STORE = "kv";
const IDB_KEY = "main";

/* ------------------------------- FS helpers ------------------------------- */
function hasFs() {
    try { return !!(window?.require?.("fs")); } catch { return false; }
}
function fsApi() {
    const fs = window.require("fs");
    const path = window.require("path");
    const base = process.cwd();
    const dir = path.join(base, "data");
    const file = path.join(dir, "products.db.json");
    return { fs, path, dir, file, base };
}

/* ----------------------------- base structures ---------------------------- */
const uniq = (arr = []) => Array.from(new Set((arr || []).filter(Boolean)));
const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
};

function defaultState() {
    return {
        schemaVersion: 3,
        categories: [...DEFAULT_CATEGORIES],
        makes: {},     // { [category]: string[] }
        models: {},    // { [category]: { [make]: string[] } }
        products: [],  // product[]
        racks: [],     // rack[]
    };
}

/* --------------------------- normalizers/migrations --------------------------- */
function normalizeImages(p) {
    const inArr = Array.isArray(p?.images) ? p.images : [];
    let images = inArr.map((x) => String(x || "")).filter(Boolean);

    const legacy = String(p?.image || "");
    if (!images.length && legacy) images = [legacy];

    const cover = images[0] || legacy || "";
    return { images, image: cover };
}

function cleanProduct(p) {
    const ru = p?.rackU == null || p?.rackU === "" ? null : Math.max(1, Math.min(5, Number(p.rackU)));
    const { images, image } = normalizeImages(p);

    return {
        id: p?.id || uuid(),
        name: String(p?.name || ""),
        category: String(p?.category || "AV"),
        make: String(p?.make || "Generic"),
        model: String(p?.model || "Default"),
        typeTags: uniq(p?.typeTags || []),

        dims: {
            w: num(p?.dims?.w ?? p?.width, 0),
            h: num(p?.dims?.h ?? p?.height, 0),
            l: num(p?.dims?.l ?? p?.length, 0),
        },

        weight: num(p?.weight, 0),
        description: String(p?.description || ""),

        // image (cover) + images (slideshow)
        image,
        images,

        rackU: ru,

        // used for merge import precedence
        updatedAt: Number.isFinite(Number(p?.updatedAt)) ? Number(p.updatedAt) : Date.now(),
    };
}

function cleanRack(r) {
    return {
        id: r?.id || uuid(),
        name: String(r?.name || "Rack"),
        width: num(r?.width, 60),
        height: num(r?.height, 200),
        length: num(r?.length, 80),
        weight: num(r?.weight, 0),
        items: Array.isArray(r?.items)
            ? r.items
                .map((it) =>
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
    s.categories = uniq(raw?.categories || s.categories);
    s.makes = raw?.makes || {};
    s.models = raw?.models || {};
    s.products = Array.isArray(raw?.products) ? raw.products.map(cleanProduct) : [];
    s.racks = Array.isArray(raw?.racks) ? raw.racks.map(cleanRack) : [];
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
            out.models[cat]["Generic"] = uniq([...(out.models[cat]["Generic"] || []), ...(raw.subcats[cat] || [])]);
        }
    }

    (raw?.products || []).forEach((p) => {
        const category = p?.category || out.categories[0] || "AV";
        const make = p?.make || "Generic";
        const model = p?.model || p?.subcategory || "Default";

        out.categories = uniq([...out.categories, category]);
        out.makes[category] = uniq([...(out.makes[category] || []), make]);
        out.models[category] ||= {};
        out.models[category][make] = uniq([...(out.models[category][make] || []), model]);

        out.products.push(cleanProduct({ ...p, category, make, model }));
    });

    // racks didn't exist in v1
    out.racks = [];
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

/* ----------------------------- in-memory cache ---------------------------- */
let MEM = null;
let HYDRATING = false;
let IDB_READY = false;
let listeners = new Set();

function notify() {
    for (const fn of listeners) {
        try { fn(); } catch {}
    }
    try {
        window.dispatchEvent(new CustomEvent("epic3d-products-changed"));
    } catch {}
}

export function subscribeProductsStore(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/* ------------------------------- IndexedDB -------------------------------- */
function openIdb() {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(IDB_NAME, IDB_VER);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE, { keyPath: "key" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

async function idbGetState() {
    const db = await openIdb();
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const st = tx.objectStore(IDB_STORE);
        const req = st.get(IDB_KEY);
        req.onsuccess = () => resolve(req.result?.value || null);
        req.onerror = () => resolve(null);
    });
}

async function idbPutState(state) {
    const db = await openIdb();
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        const st = tx.objectStore(IDB_STORE);
        st.put({ key: IDB_KEY, value: state });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
    });
}

/* --------------------------------- IO ------------------------------------ */
function readFsSync() {
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
}

function readLegacyLocalStorageOnce() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return normalizeOnLoad(parsed);
    } catch {
        return null;
    }
}

function clearLegacyLocalStorage() {
    try { localStorage.removeItem(STORE_KEY); } catch {}
}

let persistTimer = 0;
let lastPersistJsonSize = 0;

function schedulePersistToIdb(state) {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(async () => {
        persistTimer = 0;
        try {
            const ok = await idbPutState(state);
            IDB_READY = ok || IDB_READY;
        } catch {
            // ignore
        }
    }, 250);
}

// hydrate runs in background (browser)
async function hydrateBrowser() {
    if (HYDRATING) return;
    HYDRATING = true;

    // 1) If localStorage has legacy store, use it immediately + migrate to IDB.
    const legacy = readLegacyLocalStorageOnce();
    if (legacy) {
        MEM = legacy;
        notify();

        // migrate async, then clear localStorage to stop quota errors
        try { await idbPutState(MEM); IDB_READY = true; } catch {}
        clearLegacyLocalStorage();
        HYDRATING = false;
        return;
    }

    // 2) Otherwise read from IndexedDB
    try {
        const fromIdb = await idbGetState();
        if (fromIdb) MEM = normalizeOnLoad(fromIdb);
        IDB_READY = true;
    } catch {
        // ignore
    }

    notify();
    HYDRATING = false;
}

// public read (sync)
function read() {
    if (MEM) return MEM;

    // First access: seed and hydrate
    MEM = defaultState();

    if (hasFs()) {
        MEM = readFsSync();
        notify();
        return MEM;
    }

    // Browser: kick off async hydrate (IDB or localStorage migration)
    hydrateBrowser();
    return MEM;
}

// public write (sync update + async persist when in browser)
function write(state) {
    const s = normalizeOnLoad(state);
    MEM = s;

    if (hasFs()) {
        const { fs, dir, file } = fsApi();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(s, null, 2), "utf-8");
        notify();
        return s;
    }

    // Browser: NEVER write big payloads to localStorage (quota). Only IDB.
    // Clear legacy key if it still exists.
    clearLegacyLocalStorage();

    // Async persist with debounce
    schedulePersistToIdb(s);
    notify();
    return s;
}

/* ----------------------------- helpers ---------------------------- */
function ensureTaxonomyForProduct(s, p) {
    const cat = String(p.category || "AV");
    const make = String(p.make || "Generic");
    const model = String(p.model || "Default");

    if (!s.categories.includes(cat)) s.categories.push(cat);

    s.makes[cat] ||= [];
    if (!s.makes[cat].includes(make)) s.makes[cat].push(make);

    s.models[cat] ||= {};
    s.models[cat][make] ||= [];
    if (!s.models[cat][make].includes(model)) s.models[cat][make].push(model);
}

/* ----------------------------- read-only ------------------------------- */
export function getState() { return read(); }
export function listCategories() { return getState().categories || []; }
export function listMakes(category) { return getState().makes?.[category] || []; }
export function listModels(category, make) { return getState().models?.[category]?.[make] || []; }

export function listProducts(category, make, model) {
    let arr = getState().products || [];
    if (category) arr = arr.filter((p) => p.category === category);
    if (make) arr = arr.filter((p) => p.make === make);
    if (model) arr = arr.filter((p) => p.model === model);
    return arr;
}

export function listRacks() { return getState().racks || []; }

export function getProductById(id) {
    return (getState().products || []).find((p) => p.id === id) || null;
}
export function getRackById(id) {
    return (getState().racks || []).find((r) => r.id === id) || null;
}

/* ----------------------------- taxonomy mutators ------------------------------- */
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

export function deleteCategory(cat) {
    const s = read();
    const c = String(cat || "");
    s.categories = (s.categories || []).filter((x) => x !== c);
    delete s.makes[c];
    delete s.models[c];
    write(s);
}

export function ensureMake(category, make) {
    const s = read();
    const cat = String(category || "").trim();
    const m = String(make || "").trim();
    if (!cat || !m) return [];
    ensureCategory(cat);
    s.makes[cat] ||= [];
    if (!s.makes[cat].includes(m)) s.makes[cat].push(m);
    s.models[cat] ||= {};
    s.models[cat][m] ||= [];
    write(s);
    return s.makes[cat];
}

export function deleteMake(category, make) {
    const s = read();
    const cat = String(category || "");
    const m = String(make || "");
    s.makes[cat] = (s.makes[cat] || []).filter((x) => x !== m);
    if (s.models?.[cat]) delete s.models[cat][m];
    write(s);
}

export function ensureModel(category, make, model) {
    const s = read();
    const cat = String(category || "").trim();
    const m = String(make || "").trim();
    const md = String(model || "").trim();
    if (!cat || !m || !md) return [];
    ensureMake(cat, m);
    s.models[cat] ||= {};
    s.models[cat][m] ||= [];
    if (!s.models[cat][m].includes(md)) s.models[cat][m].push(md);
    write(s);
    return s.models[cat][m];
}

export function deleteModel(category, make, model) {
    const s = read();
    const cat = String(category || "");
    const m = String(make || "");
    const md = String(model || "");

    if (!s.models?.[cat]?.[m]) return;

    // remove matching products
    const removed = new Set(
        (s.products || []).filter((p) => p.category === cat && p.make === m && p.model === md).map((p) => p.id)
    );
    s.products = (s.products || []).filter((p) => !(p.category === cat && p.make === m && p.model === md));
    s.models[cat][m] = (s.models[cat][m] || []).filter((x) => x !== md);

    // purge from racks
    s.racks = (s.racks || []).map((r) => ({ ...r, items: (r.items || []).filter((i) => !removed.has(i.productId)) }));
    write(s);
}

/* ----------------------------- products ------------------------------- */
export function upsertProduct(p) {
    const s = read();
    const clean = cleanProduct({ ...(p || {}), updatedAt: Date.now() });
    ensureTaxonomyForProduct(s, clean);

    const i = (s.products || []).findIndex((x) => x.id === clean.id);
    if (i >= 0) s.products[i] = clean;
    else s.products.push(clean);

    write(s);
    return clean;
}

export function deleteProduct(id) {
    const s = read();
    const pid = String(id || "");
    s.products = (s.products || []).filter((p) => p.id !== pid);
    s.racks = (s.racks || []).map((r) => ({ ...r, items: (r.items || []).filter((i) => i.productId !== pid) }));
    write(s);
}

/* ----------------------------- racks ------------------------------- */
export function upsertRack(rack) {
    const s = read();
    const clean = cleanRack(rack || {});
    const i = (s.racks || []).findIndex((x) => x.id === clean.id);
    if (i >= 0) s.racks[i] = clean;
    else s.racks.push(clean);
    write(s);
    return clean;
}

export function deleteRack(id) {
    const s = read();
    const rid = String(id || "");
    s.racks = (s.racks || []).filter((r) => r.id !== rid);
    write(s);
}

export function addProductToRack(rackId, productId, qty = 1) {
    const s = read();
    const rid = String(rackId || "");
    const pid = String(productId || "");
    const r = (s.racks || []).find((x) => x.id === rid);
    if (!r) return;
    r.items ||= [];
    const ex = r.items.find((i) => i.productId === pid);
    const q = Math.max(1, num(qty, 1));
    if (ex) ex.qty = Math.max(1, num(ex.qty, 1) + q);
    else r.items.push({ productId: pid, qty: q });
    write(s);
}

export function removeProductFromRack(rackId, productId, qty = 1) {
    const s = read();
    const rid = String(rackId || "");
    const pid = String(productId || "");
    const r = (s.racks || []).find((x) => x.id === rid);
    if (!r) return;
    r.items ||= [];
    const ex = r.items.find((i) => i.productId === pid);
    if (!ex) return;
    const next = Math.max(0, num(ex.qty, 1) - Math.max(1, num(qty, 1)));
    if (next <= 0) r.items = r.items.filter((i) => i !== ex);
    else ex.qty = next;
    write(s);
}

export function setRackItems(rackId, newItems = []) {
    const s = read();
    const rid = String(rackId || "");
    const r = (s.racks || []).find((x) => x.id === rid);
    if (!r) return false;
    r.items = Array.isArray(newItems) ? newItems : [];
    write(s);
    return true;
}

export function moveRackItem(rackId, fromIndex, toIndex) {
    const s = read();
    const rid = String(rackId || "");
    const r = (s.racks || []).find((x) => x.id === rid);
    if (!r) return false;
    const items = Array.from(r.items || []);
    if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return false;
    const [m] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, m);
    r.items = items;
    write(s);
    return true;
}

export function setRackItemQty(rackId, productId, qty) {
    const s = read();
    const rid = String(rackId || "");
    const pid = String(productId || "");
    const r = (s.racks || []).find((x) => x.id === rid);
    if (!r) return;
    r.items ||= [];
    const ex = r.items.find((i) => i.productId === pid);
    const q = Math.max(0, num(qty, 0));
    if (!ex && q > 0) r.items.push({ productId: pid, qty: q });
    else if (ex && q <= 0) r.items = r.items.filter((i) => i !== ex);
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

    // ensure IDB write completes (best effort)
    if (!hasFs()) {
        try { await idbPutState(state); IDB_READY = true; } catch {}
    }
    return state;
}

export async function mergeProductsFile(file) {
    const txt = await file.text();
    const obj = JSON.parse(txt);
    const incoming = normalizeOnLoad(obj);
    const cur = read();

    const byId = new Map((cur.products || []).map((p) => [p.id, p]));
    for (const p of (incoming.products || [])) {
        const clean = cleanProduct(p);
        const existing = byId.get(clean.id);
        if (!existing) {
            byId.set(clean.id, clean);
        } else {
            // prefer newer updatedAt if present
            const a = Number(existing.updatedAt) || 0;
            const b = Number(clean.updatedAt) || 0;
            byId.set(clean.id, b >= a ? clean : existing);
        }
    }

    const merged = {
        ...cur,
        categories: uniq([...(cur.categories || []), ...(incoming.categories || [])]),
        makes: { ...(cur.makes || {}) },
        models: { ...(cur.models || {}) },
        products: Array.from(byId.values()),
        racks: Array.isArray(cur.racks) ? cur.racks : [],
        schemaVersion: 3,
    };

    // merge taxonomy for incoming products
    for (const p of merged.products) ensureTaxonomyForProduct(merged, p);

    write(merged);

    if (!hasFs()) {
        try { await idbPutState(merged); IDB_READY = true; } catch {}
    }
    return merged;
}

// Kick off hydration ASAP so caches populate quickly.
read();

/* eslint-disable no-restricted-globals */

self.onmessage = (e) => {
    const payload = e?.data || {};
    const id = payload.id;
    const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const clusters = Array.isArray(payload.clusters) ? payload.clusters : [];

    const result = {};
    for (const r of rooms) {
        if (!r || !r.id) continue;
        const cats = {};
        for (const c of clusters) cats[c] = [];
        result[r.id] = { room: r, cats };
    }

    const unassigned = { id: "__no_room__", name: "Unassigned", center: [0, 0, 0], size: [0, 0, 0] };
    if (!result[unassigned.id]) {
        const cats = {};
        for (const c of clusters) cats[c] = [];
        result[unassigned.id] = { room: unassigned, cats };
    }

    for (const n of nodes) {
        if (!n || !n.id) continue;
        const bucket = (n.roomId && result[n.roomId]) ? result[n.roomId] : result[unassigned.id];
        const cat = n.cluster || "uncategorized";
        if (!bucket.cats[cat]) bucket.cats[cat] = [];
        bucket.cats[cat].push(n.id);
    }

    self.postMessage({ id, grouped: result });
};

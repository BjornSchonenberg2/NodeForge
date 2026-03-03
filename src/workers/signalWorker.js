/* eslint-disable no-restricted-globals */

self.onmessage = (e) => {
    const payload = e?.data || {};
    const id = payload.id;
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const links = Array.isArray(payload.links) ? payload.links : [];
    const hiddenDeckIds = new Set(Array.isArray(payload.hiddenDeckIds) ? payload.hiddenDeckIds : []);
    const hiddenRoomIds = new Set(Array.isArray(payload.hiddenRoomIds) ? payload.hiddenRoomIds : []);

    const visibleIds = [];
    const map = {};

    for (const n of nodes) {
        if (!n || !n.id) continue;
        map[n.id] = [];
        const hidden = !!n.hidden;
        if (hidden) continue;
        if (n.role === "none") continue;
        if (n.deckId && hiddenDeckIds.has(n.deckId)) continue;
        if (n.roomId && hiddenRoomIds.has(n.roomId)) continue;
        visibleIds.push(n.id);
    }

    for (const l of links) {
        if (!l) continue;
        if (map[l.from]) map[l.from].push(l.to);
        if (map[l.to]) map[l.to].push(l.from);
    }

    self.postMessage({ id, map, visibleIds });
};

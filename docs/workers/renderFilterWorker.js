/* eslint-disable no-restricted-globals */

self.onmessage = (e) => {
    const payload = e?.data || {};
    const id = payload.id;
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    const links = Array.isArray(payload.links) ? payload.links : [];
    const groups = Array.isArray(payload.groups) ? payload.groups : [];

    const groupHidden = new Map();
    const groupRoomsHidden = new Map();
    for (const g of groups) {
        if (!g || !g.id) continue;
        groupHidden.set(g.id, !!g.hidden);
        groupRoomsHidden.set(g.id, !!g.hideRooms);
    }

    const renderNodeIds = [];
    const renderNodeIdSet = new Set();
    for (const n of nodes) {
        if (!n || !n.id) continue;
        const gid = n.groupId;
        if (gid && groupHidden.get(gid)) continue;
        renderNodeIds.push(n.id);
        renderNodeIdSet.add(n.id);
    }

    const renderRoomIds = [];
    for (const r of rooms) {
        if (!r || !r.id) continue;
        const gid = r.groupId;
        if (gid && groupHidden.get(gid)) continue;
        if (gid && groupRoomsHidden.get(gid)) continue;
        renderRoomIds.push(r.id);
    }

    const renderLinkIds = [];
    for (const l of links) {
        if (!l || !l.id) continue;
        if (renderNodeIdSet.has(l.from) && renderNodeIdSet.has(l.to)) {
            renderLinkIds.push(l.id);
        }
    }

    self.postMessage({ id, renderNodeIds, renderRoomIds, renderLinkIds });
};

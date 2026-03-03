/* eslint-disable no-restricted-globals */

self.onmessage = (e) => {
    const payload = e?.data || {};
    const id = payload.id;
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    const roomIds = new Set(Array.isArray(payload.roomIds) ? payload.roomIds : []);
    const deckIds = new Set(Array.isArray(payload.deckIds) ? payload.deckIds : []);
    const groupIds = new Set(Array.isArray(payload.groupIds) ? payload.groupIds : []);

    const removeNodeIds = new Set();
    const removeRoomIds = new Set();

    if (roomIds.size) {
        for (const n of nodes) {
            const rid = n?.roomId != null ? String(n.roomId) : "";
            if (rid && roomIds.has(rid)) removeNodeIds.add(String(n.id));
        }
    }

    if (deckIds.size) {
        for (const r of rooms) {
            const did = r?.deckId != null ? String(r.deckId) : "";
            if (did && deckIds.has(did)) removeRoomIds.add(String(r.id));
        }
        for (const n of nodes) {
            const did = n?.deckId != null ? String(n.deckId) : "";
            if (did && deckIds.has(did)) removeNodeIds.add(String(n.id));
        }
    }

    if (groupIds.size) {
        for (const r of rooms) {
            const gid = r?.groupId != null ? String(r.groupId) : "";
            if (gid && groupIds.has(gid)) removeRoomIds.add(String(r.id));
        }
        for (const n of nodes) {
            const gid = n?.groupId != null ? String(n.groupId) : "";
            if (gid && groupIds.has(gid)) removeNodeIds.add(String(n.id));
        }
    }

    self.postMessage({
        id,
        removeNodeIds: Array.from(removeNodeIds),
        removeRoomIds: Array.from(removeRoomIds),
    });
};

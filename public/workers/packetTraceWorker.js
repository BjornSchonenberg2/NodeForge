/* eslint-disable no-restricted-globals */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const normalizePacketStyle = (styleRaw) => {
    const s0 = String(styleRaw || "").toLowerCase();
    let s = s0;
    if (s === "square") s = "cube";
    if (s === "shard") s = "diamond";
    if (s === "static") s = "cube";
    if (s === "comet") s = "orb";
    return s || null;
};

const getPacketPresetFromLink = (link) => {
    if (!link) return null;
    const p = link.packet || {};
    const v = p.visual || {};
    const styleRaw = p.style || p.packetStyle || v.shape || v.packetShape || v.style || null;
    const style = styleRaw ? normalizePacketStyle(styleRaw) : null;
    const text = p.text || p.label || v.text || null;
    const color = p.color || v.color || null;
    const size = (p.size != null ? p.size : (v.size != null ? v.size : null));
    const opacity = (p.opacity != null ? p.opacity : null);
    if (style == null && text == null && color == null && size == null && opacity == null) return null;
    return { style, text, color, size, opacity };
};

self.onmessage = (e) => {
    const payload = e?.data || {};
    const id = payload.id;
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const links = Array.isArray(payload.links) ? payload.links : [];
    const step = payload.step || {};

    const srcId = step.sourceNodeId || step.sourceId || "";
    const dstId = step.targetNodeId || step.targetId || "";
    const cast = String(step.cast || step.castMode || "unicast").toLowerCase();
    const wantsTrace = String(step.packetMode || "").toLowerCase() === "trace";
    if (!wantsTrace || !srcId || !dstId) {
        self.postMessage({ id, ok: false, schedule: [], packetPreset: null });
        return;
    }

    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const linksById = new Map(links.map((l) => [l.id, l]));

    const outAdj = new Map();
    const inAdj = new Map();
    for (const l of links) {
        if (!l || !l.from || !l.to) continue;
        if (!outAdj.has(l.from)) outAdj.set(l.from, []);
        outAdj.get(l.from).push({ to: l.to, link: l });
        if (!inAdj.has(l.to)) inAdj.set(l.to, []);
        inAdj.get(l.to).push({ from: l.from, link: l });
    }

    const dist3 = (a, b) => {
        const aa = a && a.position ? a.position : a;
        const bb = b && b.position ? b.position : b;
        const ax = (aa && aa[0]) ?? aa?.x ?? 0;
        const ay = (aa && aa[1]) ?? aa?.y ?? 0;
        const az = (aa && aa[2]) ?? aa?.z ?? 0;
        const bx = (bb && bb[0]) ?? bb?.x ?? 0;
        const by = (bb && bb[1]) ?? bb?.y ?? 0;
        const bz = (bb && bb[2]) ?? bb?.z ?? 0;
        const dx = ax - bx, dy = ay - by, dz = az - bz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    const getTravelSec = (link) => {
        if (!link) return 1.0;
        const p = link.packet || {};
        const t = (p.timing && p.timing.travel != null) ? p.timing.travel : (p.travel != null ? p.travel : null);
        const tt = Number(t);
        if (Number.isFinite(tt) && tt > 0) return clamp(tt, 0.05, 8);
        const a = nodesById.get(link.from);
        const b = nodesById.get(link.to);
        const d = dist3(a?.position, b?.position);
        const sec = d / 2.4;
        return clamp(sec, 0.25, 4.0);
    };

    let packetPreset = null;
    {
        const profileId = step.packetProfileLinkId || step.packetLinkId || step.profileLinkId || step.linkId || null;
        if (profileId && linksById.get(profileId)) {
            packetPreset = getPacketPresetFromLink(linksById.get(profileId));
        }
    }

    const baseDelay = Math.max(0, Number(step.delay ?? 0) || 0);
    const schedule = [];

    const sendUnicast = () => {
        const prev = new Map();
        const q = [srcId];
        prev.set(srcId, null);
        while (q.length) {
            const u = q.shift();
            if (u === dstId) break;
            const outs = outAdj.get(u) || [];
            for (const e of outs) {
                const v = e.to;
                if (!v || prev.has(v)) continue;
                prev.set(v, { p: u, linkId: e.link?.id });
                q.push(v);
            }
        }
        if (!prev.has(dstId)) return false;
        const hops = [];
        let cur = dstId;
        while (cur && cur !== srcId) {
            const info = prev.get(cur);
            if (!info || !info.linkId) break;
            hops.push({ linkId: info.linkId, from: info.p, to: cur });
            cur = info.p;
        }
        hops.reverse();

        if (!packetPreset && hops.length > 0) {
            const firstLink = linksById.get(hops[0].linkId);
            packetPreset = getPacketPresetFromLink(firstLink);
        }

        let t = baseDelay;
        for (const h of hops) {
            const link = linksById.get(h.linkId);
            const travel = getTravelSec(link);
            schedule.push({ linkId: h.linkId, tStart: t, travel });
            t += travel;
        }
        return hops.length > 0;
    };

    const sendMulticast = () => {
        const dist = new Map();
        dist.set(dstId, 0);
        const q = [dstId];
        while (q.length) {
            const v = q.shift();
            const dv = dist.get(v) || 0;
            const ins = inAdj.get(v) || [];
            for (const e of ins) {
                const u = e.from;
                if (!u || dist.has(u)) continue;
                dist.set(u, dv + 1);
                q.push(u);
            }
        }
        if (!dist.has(srcId)) return false;

        if (!packetPreset) {
            const outs0 = outAdj.get(srcId) || [];
            const preferred = outs0.find((e) => e?.link?.packet) || outs0[0];
            packetPreset = getPacketPresetFromLink(preferred?.link);
        }

        const maxEdges = Math.max(20, Math.min(2400, Number(step.maxEdges ?? 640) || 640));
        const baseHops = dist.get(srcId) || 0;
        const maxHops = Math.max(1, Math.min(64, Number(step.maxHops ?? (baseHops + 10)) || (baseHops + 10)));

        let scheduled = 0;
        const bestHops = new Map();
        const qq = [{ node: srcId, t: baseDelay, prev: null, hops: 0 }];
        bestHops.set(srcId, 0);

        while (qq.length && scheduled < maxEdges) {
            const st = qq.shift();
            const u = st.node;
            if (u === dstId) continue;
            if (st.hops >= maxHops) continue;

            const outs = outAdj.get(u) || [];
            const sorted = outs.slice().sort((a, b) => {
                const da = dist.has(a.to) ? dist.get(a.to) : 1e9;
                const db = dist.has(b.to) ? dist.get(b.to) : 1e9;
                if (da !== db) return da - db;
                return String(a.to).localeCompare(String(b.to));
            });

            for (const e of sorted) {
                const v = e.to;
                if (!v) continue;
                if (st.prev && v === st.prev) continue;

                const floodAll = (step.multicastFloodAll ?? true) === true;
                if (!floodAll && !dist.has(v)) continue;

                const nextHops = st.hops + 1;
                const best = bestHops.get(v);
                if (best != null && best <= nextHops) continue;
                bestHops.set(v, nextHops);

                const link = e.link;
                const travel = getTravelSec(link);
                schedule.push({ linkId: link.id, tStart: st.t, travel });
                scheduled++;
                qq.push({ node: v, t: st.t + travel, prev: u, hops: nextHops });
                if (scheduled >= maxEdges) break;
            }
        }
        return scheduled > 0;
    };

    const ok = (cast === "multicast") ? sendMulticast() : sendUnicast();
    self.postMessage({ id, ok, schedule, packetPreset: packetPreset || null });
};

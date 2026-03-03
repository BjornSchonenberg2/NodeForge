/* eslint-disable no-restricted-globals */

function applyFlowAnchorBends(points, anchorBendsByIndex) {
  if (!Array.isArray(points) || points.length < 3) return points;
  if (!anchorBendsByIndex || anchorBendsByIndex.size === 0) return points;
  const out = [points[0]];

  const pushPoint = (pt) => {
    const last = out[out.length - 1];
    if (
      !last ||
      Math.abs(pt[0] - last[0]) > 1e-6 ||
      Math.abs(pt[1] - last[1]) > 1e-6 ||
      Math.abs(pt[2] - last[2]) > 1e-6
    ) {
      out.push(pt);
    }
  };

  for (let i = 1; i < points.length - 1; i++) {
    const bendDeg = Number(anchorBendsByIndex.get(i) ?? 0) || 0;
    if (bendDeg <= 0) {
      out.push(points[i]);
      continue;
    }
    if (Math.abs(bendDeg - 90) <= 1e-6) {
      const prev = points[i - 1];
      const cur = points[i];
      const next = points[i + 1];
      const dxIn = (cur[0] || 0) - (prev[0] || 0);
      const dzIn = (cur[2] || 0) - (prev[2] || 0);
      const dxOut = (next[0] || 0) - (cur[0] || 0);
      const dzOut = (next[2] || 0) - (cur[2] || 0);
      const inCorner = Math.abs(dxIn) >= Math.abs(dzIn)
        ? [cur[0], cur[1], prev[2]]
        : [prev[0], cur[1], cur[2]];
      const outCorner = Math.abs(dxOut) >= Math.abs(dzOut)
        ? [next[0], cur[1], cur[2]]
        : [cur[0], cur[1], next[2]];
      pushPoint(inCorner);
      pushPoint(cur);
      pushPoint(outCorner);
      continue;
    }

    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const prevV = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const nextV = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const prevLen = Math.hypot(prevV[0], prevV[1], prevV[2]);
    const nextLen = Math.hypot(nextV[0], nextV[1], nextV[2]);
    if (prevLen <= 1e-6 || nextLen <= 1e-6) {
      out.push(points[i]);
      continue;
    }

    const inset = Math.min(prevLen, nextLen) * Math.min(0.45, Math.max(0.05, (bendDeg / 180) * 0.4));
    const prevN = [prevV[0] / prevLen, prevV[1] / prevLen, prevV[2] / prevLen];
    const nextN = [nextV[0] / nextLen, nextV[1] / nextLen, nextV[2] / nextLen];
    const before = [p1[0] - prevN[0] * inset, p1[1] - prevN[1] * inset, p1[2] - prevN[2] * inset];
    const after = [p1[0] + nextN[0] * inset, p1[1] + nextN[1] * inset, p1[2] + nextN[2] * inset];
    out.push(before, p1, after);
  }
  out.push(points[points.length - 1]);
  return out;
}

function forceOrthogonalXZ(points) {
  if (!Array.isArray(points) || points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const overallDx = (last?.[0] || 0) - (first?.[0] || 0);
  const overallDz = (last?.[2] || 0) - (first?.[2] || 0);
  const preferXFirst =
    Math.abs(overallDx) > 1e-6 &&
    (Math.abs(overallDx) >= Math.abs(overallDz) || Math.abs(overallDz) <= 1e-6);

  const out = [first];
  const pushUnique = (pt) => {
    const lastPt = out[out.length - 1];
    if (
      !lastPt ||
      Math.abs(pt[0] - lastPt[0]) > 1e-6 ||
      Math.abs(pt[1] - lastPt[1]) > 1e-6 ||
      Math.abs(pt[2] - lastPt[2]) > 1e-6
    ) {
      out.push(pt);
    }
  };

  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const target = points[i];
    const dx = (target[0] || 0) - (prev[0] || 0);
    const dz = (target[2] || 0) - (prev[2] || 0);
    if (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6) {
      const goXFirst = i === 1 ? preferXFirst : Math.abs(dx) >= Math.abs(dz);
      const rawMid = goXFirst
        ? [target[0], prev[1], prev[2]]
        : [prev[0], prev[1], target[2]];
      const minX = Math.min(prev[0], target[0]);
      const maxX = Math.max(prev[0], target[0]);
      const minZ = Math.min(prev[2], target[2]);
      const maxZ = Math.max(prev[2], target[2]);
      const mid = [
        Math.min(maxX, Math.max(minX, rawMid[0])),
        rawMid[1],
        Math.min(maxZ, Math.max(minZ, rawMid[2])),
      ];
      pushUnique(mid);
    }
    pushUnique(target);
  }
  return out;
}

const TAU = Math.PI * 2;
function hashAngle(id) {
  const s = String(id ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h >>> 0) / 4294967295;
  return u * TAU;
}

function endpointOffsetXZ(node, idx, count) {
  const r = Number(node?.flowAnchor ?? node?.anchorSpread ?? 0);
  if (!Number.isFinite(r) || r <= 0 || !count || count <= 1) return [0, 0, 0];
  const base = hashAngle(node?.id || "");
  const a = base + (idx / count) * TAU;
  return [Math.cos(a) * r, 0, Math.sin(a) * r];
}

function getFlowAnchorSets(node) {
  const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
  if (sets.length) return sets;
  const legacyAnchors = Array.isArray(node?.flowAnchors) ? node.flowAnchors : [];
  if (legacyAnchors.length) {
    return [{
      id: node?.flowAnchorActiveSetId || "fas-default",
      name: "Default",
      anchors: legacyAnchors,
      globalBendDeg: node?.flowAnchorGlobalBendDeg ?? 0,
      dynamicBreakpoints: node?.flowAnchorDynamicBreakpoints ?? false,
      noDiagonal: node?.flowAnchorNoDiagonal ?? false,
      spreadPaths: node?.flowAnchorSpreadPaths ?? 0,
      hideRings: node?.flowAnchorsHideRings ?? false,
    }];
  }
  return [];
}

function findFlowAnchorSet(node, setId, allowFallback = true) {
  const sets = getFlowAnchorSets(node);
  if (!sets.length) return null;
  if (setId) {
    const hit = sets.find((s) => s?.id === setId);
    if (hit) return hit;
    if (!allowFallback) return null;
  }
  return sets[0];
}

self.onmessage = (e) => {
  const payload = e?.data || {};
  const reqId = payload.id;
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const links = Array.isArray(payload.links) ? payload.links : [];
  const results = [];

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Link slots (out/in)
  const outBy = new Map();
  const inBy = new Map();
  links.forEach((l) => {
    if (!l || !l.id) return;
    if (l.from != null) {
      if (!outBy.has(l.from)) outBy.set(l.from, []);
      outBy.get(l.from).push(l.id);
    }
    if (l.to != null) {
      if (!inBy.has(l.to)) inBy.set(l.to, []);
      inBy.get(l.to).push(l.id);
    }
  });
  const linkSlots = { out: new Map(), inn: new Map() };
  outBy.forEach((ids) => {
    ids.sort();
    const count = ids.length || 1;
    ids.forEach((id, idx) => linkSlots.out.set(id, { idx, count }));
  });
  inBy.forEach((ids) => {
    ids.sort();
    const count = ids.length || 1;
    ids.forEach((id, idx) => linkSlots.inn.set(id, { idx, count }));
  });

  // Anchor set slots (spread)
  const buckets = new Map();
  links.forEach((l) => {
    if (!l || !l.id) return;
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) return;
    const selection = (() => {
      const candidates = [b, a];
      if (l.flowAnchorSetOwnerId) {
        const ownerKey = String(l.flowAnchorSetOwnerId);
        const preferred = candidates.find((cand) => String(cand?.id) === ownerKey);
        if (preferred) {
          const set = findFlowAnchorSet(preferred, l.flowAnchorSetId, false)
            || findFlowAnchorSet(preferred, null, true);
          if (set) return { owner: preferred, set };
        }
      }
      if (l.flowAnchorSetId) {
        for (const cand of candidates) {
          if (!cand || cand.flowAnchorsEnabled !== true) continue;
          const set = findFlowAnchorSet(cand, l.flowAnchorSetId, false);
          if (set) return { owner: cand, set };
        }
      }
      for (const cand of candidates) {
        if (!cand || cand.flowAnchorsEnabled !== true) continue;
        const set = findFlowAnchorSet(cand, null, true);
        if (set) return { owner: cand, set };
      }
      return { owner: null, set: null };
    })();
    if (!selection.owner || !selection.set) return;
    const dir = selection.owner === b ? "in" : "out";
    const key = `${selection.owner.id}:${selection.set.id}:${dir}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ id: l.id, ownerId: selection.owner.id });
  });
  const anchorSetSlots = new Map();
  const angleThreshold = (12 * Math.PI) / 180;
  const linkById = new Map(links.map((l) => [l.id, l]));
  buckets.forEach((items) => {
    const entries = items.map((item) => {
      const link = linkById.get(item.id);
      if (!link) return null;
      const owner = byId.get(item.ownerId);
      if (!owner) return null;
      const otherId = owner.id === link.from ? link.to : link.from;
      const other = byId.get(otherId);
      if (!other) return null;
      const ownerPos = owner.position || [0, 0, 0];
      const otherPos = other.position || [0, 0, 0];
      let dx = (otherPos[0] || 0) - (ownerPos[0] || 0);
      let dy = (otherPos[1] || 0) - (ownerPos[1] || 0);
      let dz = (otherPos[2] || 0) - (ownerPos[2] || 0);
      let len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) {
        dx = 1; dy = 0; dz = 0; len = 1;
      }
      dx /= len; dy /= len; dz /= len;
      return { id: item.id, dirV: [dx, dy, dz] };
    }).filter(Boolean);

    const groups = [];
    entries.forEach((entry) => {
      let target = null;
      for (const g of groups) {
        const dot = g.dir[0] * entry.dirV[0] + g.dir[1] * entry.dirV[1] + g.dir[2] * entry.dirV[2];
        const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (ang <= angleThreshold) {
          target = g;
          break;
        }
      }
      if (!target) {
        groups.push({ dir: entry.dirV.slice(), ids: [entry.id] });
      } else {
        target.ids.push(entry.id);
        const blend = [
          target.dir[0] + entry.dirV[0],
          target.dir[1] + entry.dirV[1],
          target.dir[2] + entry.dirV[2],
        ];
        const blen = Math.hypot(blend[0], blend[1], blend[2]) || 1;
        target.dir = [blend[0] / blen, blend[1] / blen, blend[2] / blen];
      }
    });
    groups.forEach((g) => {
      g.ids.sort();
      const count = g.ids.length || 1;
      g.ids.forEach((id, idx) => anchorSetSlots.set(id, { idx, count }));
    });
  });

  for (const l of links) {
    if (!l || !l.id) continue;
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) {
      results.push({ id: l.id, points: [] });
      continue;
    }
    const outSlot = linkSlots.out.get(l.id) || { idx: 0, count: 1 };
    const inSlot = linkSlots.inn.get(l.id) || { idx: 0, count: 1 };
    const ao = endpointOffsetXZ(a, outSlot.idx, outSlot.count);
    const bo = endpointOffsetXZ(b, inSlot.idx, inSlot.count);
    const aPos = a.position || [0, 0, 0];
    const bPos = b.position || [0, 0, 0];
    const start = [
      (aPos[0] || 0) + ao[0],
      (aPos[1] || 0) + ao[1],
      (aPos[2] || 0) + ao[2],
    ];
    const end = [
      (bPos[0] || 0) + bo[0],
      (bPos[1] || 0) + bo[1],
      (bPos[2] || 0) + bo[2],
    ];

    const anchorSelection = (() => {
      const candidates = [b, a];
      if (l.flowAnchorSetOwnerId) {
        const ownerKey = String(l.flowAnchorSetOwnerId);
        const preferred = candidates.find((cand) => String(cand?.id) === ownerKey);
        if (preferred) {
          const set = findFlowAnchorSet(preferred, l.flowAnchorSetId, false)
            || findFlowAnchorSet(preferred, null, true);
          if (set) return { owner: preferred, set };
        }
      }
      if (l.flowAnchorSetId) {
        for (const cand of candidates) {
          if (!cand || cand.flowAnchorsEnabled !== true) continue;
          const set = findFlowAnchorSet(cand, l.flowAnchorSetId, false);
          if (set) return { owner: cand, set };
        }
      }
      for (const cand of candidates) {
        if (!cand || cand.flowAnchorsEnabled !== true) continue;
        const set = findFlowAnchorSet(cand, null, true);
        if (set) return { owner: cand, set };
      }
      return { owner: null, set: null };
    })();

    const anchorOwner = anchorSelection.owner;
    const anchorSet = anchorSelection.set;
    const anchorBase = anchorOwner === b ? bPos : aPos;
    const rawFlowAnchors = Array.isArray(anchorSet?.anchors) ? anchorSet.anchors : [];
    const flowAnchorGlobalBend = Number(anchorSet?.globalBendDeg ?? anchorOwner?.flowAnchorGlobalBendDeg ?? 0) || 0;
    const flowAnchorDynamicBreakpoints = anchorSet?.dynamicBreakpoints ?? anchorOwner?.flowAnchorDynamicBreakpoints;
    const flowAnchorNoDiagonal = anchorSet?.noDiagonal ?? anchorOwner?.flowAnchorNoDiagonal;
    const flowAnchorSpreadPaths = Number(anchorSet?.spreadPaths ?? 0) || 0;
    const flowAnchorSpreadIgnore = Math.max(0, Math.round(Number(anchorSet?.spreadIgnoreBreakpoints ?? 0) || 0));
    const flowAnchors = rawFlowAnchors.filter((anchor) => anchor && (anchor.enabled ?? true));
    const spreadSlot = anchorSetSlots.get(l.id);
    const spreadOffset =
      flowAnchorSpreadPaths > 0 && spreadSlot && spreadSlot.count > 1
        ? (spreadSlot.idx - (spreadSlot.count - 1) * 0.5) * flowAnchorSpreadPaths
        : 0;
    const spreadDir = (() => {
      if (!spreadOffset) return null;
      const dx = (end?.[0] ?? 0) - (start?.[0] ?? 0);
      const dz = (end?.[2] ?? 0) - (start?.[2] ?? 0);
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 1e-5) {
        const sx = -dz / len;
        const sz = dx / len;
        return [sx * spreadOffset, 0, sz * spreadOffset];
      }
      return [spreadOffset, 0, 0];
    })();

    let spreadPointIndex = 0;
    const shouldApplySpread = () => {
      spreadPointIndex += 1;
      return spreadPointIndex > flowAnchorSpreadIgnore;
    };
    const applySpread = (pt) => {
      if (!spreadDir) return pt;
      if (!shouldApplySpread()) return pt;
      return [
        (pt[0] || 0) + (spreadDir[0] || 0),
        pt[1] || 0,
        (pt[2] || 0) + (spreadDir[2] || 0),
      ];
    };

    const flowAnchorPoints = [];
    const anchorBendsByIndex = new Map();
    let anchorPointIndex = 0;
    for (const anchor of flowAnchors) {
      const pos = Array.isArray(anchor?.pos) ? anchor.pos : null;
      if (!pos) continue;
      const p = [
        (anchorBase[0] || 0) + (pos[0] || 0),
        (anchorBase[1] || 0) + (pos[1] || 0),
        (anchorBase[2] || 0) + (pos[2] || 0),
      ];
      flowAnchorPoints.push(applySpread(p));
      const bendDeg = Number(anchor?.bendDeg ?? flowAnchorGlobalBend ?? 0) || 0;
      if (bendDeg > 0) anchorBendsByIndex.set(1 + anchorPointIndex, bendDeg);
      anchorPointIndex += 1;
    }

    const findActiveSet = (node) => {
      if (!node) return null;
      const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
      if (!sets.length) return null;
      const activeId = node?.flowAnchorActiveSetId || sets[0]?.id;
      return sets.find((s) => s?.id === activeId) || sets[0] || null;
    };
    const nodeHasNoDiagonalSet = (node) => {
      if (!node) return false;
      const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
      return sets.some((s) => s?.noDiagonal === true);
    };
    const nodeHasBend90Set = (node) => {
      if (!node) return false;
      const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
      return sets.some((s) => Number(s?.globalBendDeg ?? 0) === 90);
    };
    const getGlobalBendForNode = (node) => {
      if (!node) return 0;
      const active = findActiveSet(node);
      if (active?.globalBendDeg != null) return Number(active.globalBendDeg) || 0;
      return Number(node?.flowAnchorGlobalBendDeg ?? 0) || 0;
    };
    const getNoDiagonalForNode = (node) => {
      if (!node) return false;
      const active = findActiveSet(node);
      return active?.noDiagonal === true || node?.flowAnchorNoDiagonal === true;
    };
    const anyNoDiagonal =
      flowAnchorNoDiagonal === true ||
      getNoDiagonalForNode(a) ||
      getNoDiagonalForNode(b) ||
      nodeHasNoDiagonalSet(a) ||
      nodeHasNoDiagonalSet(b);
    const anyBend90 =
      flowAnchorGlobalBend === 90 ||
      getGlobalBendForNode(a) === 90 ||
      getGlobalBendForNode(b) === 90 ||
      nodeHasBend90Set(a) ||
      nodeHasBend90Set(b) ||
      Array.from(anchorBendsByIndex.values()).some((v) => v === 90);
    const forceOrthogonal = anyNoDiagonal || anyBend90;

    const hasLinkBps = Array.isArray(l.breakpoints) && l.breakpoints.length > 0;
    const dynamicBendEnabled =
      anchorOwner?.flowAnchorsEnabled === true &&
      flowAnchorDynamicBreakpoints === true &&
      flowAnchorGlobalBend > 0 &&
      !hasLinkBps;

    const dynamicBendPoints = [];
    if (dynamicBendEnabled) {
      const segStart = flowAnchorPoints.length
        ? flowAnchorPoints[flowAnchorPoints.length - 1]
        : start;
      const dx = end[0] - segStart[0];
      const dy = end[1] - segStart[1];
      const dz = end[2] - segStart[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 1e-4) {
        const pushPoint = (pt) => {
          const last = dynamicBendPoints[dynamicBendPoints.length - 1];
          if (
            !last ||
            Math.abs(pt[0] - last[0]) > 1e-6 ||
            Math.abs(pt[1] - last[1]) > 1e-6 ||
            Math.abs(pt[2] - last[2]) > 1e-6
          ) {
            dynamicBendPoints.push(pt);
          }
        };

        if (flowAnchorNoDiagonal) {
          const goXFirst = Math.abs(dx) >= Math.abs(dz);
          let p1 = goXFirst
            ? [end[0], segStart[1], segStart[2]]
            : [segStart[0], segStart[1], end[2]];
          let p2 = [end[0], segStart[1], end[2]];
          p1 = applySpread(p1);
          p2 = applySpread(p2);
          pushPoint(p1);
          pushPoint(p2);
        } else {
          let px = -dz;
          let pz = dx;
          const plen = Math.sqrt(px * px + pz * pz);
          if (plen > 1e-5) {
            px /= plen;
            pz /= plen;
          } else {
            px = 0;
            pz = 1;
          }
          const t = Math.min(1, Math.max(0, flowAnchorGlobalBend / 180));
          const offset = dist * (0.15 + t * 0.45);
          const midX = (segStart[0] + end[0]) * 0.5;
          const midY = (segStart[1] + end[1]) * 0.5;
          const midZ = (segStart[2] + end[2]) * 0.5;
          const cornerX = midX + px * offset;
          const cornerZ = midZ + pz * offset;

          if (flowAnchorGlobalBend >= 60) {
            if (Math.abs(dx) >= Math.abs(dz)) {
              const p1 = applySpread([cornerX, midY, segStart[2]]);
              const p2 = applySpread([cornerX, midY, end[2]]);
              dynamicBendPoints.push(p1, p2);
            } else {
              const p1 = applySpread([segStart[0], midY, cornerZ]);
              const p2 = applySpread([end[0], midY, cornerZ]);
              dynamicBendPoints.push(p1, p2);
            }
          } else {
            dynamicBendPoints.push(applySpread([cornerX, midY, cornerZ]));
          }
        }
      }
    }

    let points = [
      start,
      ...flowAnchorPoints,
      ...dynamicBendPoints,
      ...(Array.isArray(l.breakpoints) ? l.breakpoints : []),
      end,
    ];
    points = applyFlowAnchorBends(points, anchorBendsByIndex);
    if (forceOrthogonal) {
      points = forceOrthogonalXZ(points);
    }
    results.push({ id: l.id, points, forceOrthogonal });
  }

  self.postMessage({ id: reqId, results });
};

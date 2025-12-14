
// src/ui/HudButtonsLayer.jsx
// Ultra HUD button grid + epic 3D button configurator
//
// Features:
// - Grid Layout edit mode with drag, resize, snapping & grouping
// - LocalStorage persistence for positions and styles
// - Per-button 3D styling (bevel, rim light, glow, shaders, hover, press)
// - Style presets + themes + copy/paste style
// - HUD fade in/out & hide via CustomEvent API
// - Action preview works even while editing

import React from "react";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const DEFAULT_BTN = {
  x: 0,
  y: 0,
  w: 140,
  h: 42,
  fontSize: 13,
  fontWeight: 800,
  fontFamily:
      '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  textCase: "normal", // "normal" | "upper" | "lower"
  letterSpacing: 0.02, // em

  fontColor: "#ffffff",
  textOpacity: 1,

  bgColor: "#1f2937",
  bgColor2: "#3b82f6",
  bgMode: "solid", // "solid" | "linear" | "radial"
  bgOpacity: 0.85,
  gradientAngle: 135,

  borderColor: "#4b5563",
  borderOpacity: 0.9,
  borderWidth: 1,

  radius: 14,

  emboss: 12, // outer depth
  glow: 0, // outer glow

  innerBevelShadow: 0,
  innerBevelHighlight: 0,
  innerBevelSoftness: 1,

  hoverScale: 1.04,
  hoverLift: 3,
  hoverGlow: 10,
  hoverSpeed: 0.18,

  pressDepth: 2,
  pressScale: 0.97,
  rimLight: 0,

  shader: "none", // "none" | "sheen" | "deepGlass" | "softPlastic"

  titleEmboss: false,
  fadeDuration: 0.35, // seconds for opacity fade

  z: 1,
  hidden: false,
};

// Font options for dropdown
const FONT_OPTIONS = [
  {
    label: "System / Inter",
    value:
        '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    label: "Roboto",
    value:
        '"Roboto", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    label: "Poppins",
    value:
        '"Poppins", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    label: "Orbitron (sci-fi)",
    value:
        '"Orbitron", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    label: "Montserrat",
    value:
        '"Montserrat", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
];

function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function saveLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function usePersistentState(key, initial) {
  const [state, setState] = React.useState(() => loadLS(key, initial));
  React.useEffect(() => {
    saveLS(key, state);
  }, [key, state]);
  return [state, setState];
}

function edgeSnap(a, b, magnet = 8) {
  const snaps = [];
  const ax1 = a.x,
      ay1 = a.y,
      ax2 = a.x + a.w,
      ay2 = a.y + a.h;
  const bx1 = b.x,
      by1 = b.y,
      bx2 = b.x + b.w,
      by2 = b.y + b.h;

  if (Math.abs(ay1 - by1) <= magnet) snaps.push({ dx: 0, dy: by1 - ay1 });
  if (Math.abs(ay1 - by2) <= magnet) snaps.push({ dx: 0, dy: by2 - ay1 });
  if (Math.abs(ay2 - by1) <= magnet) snaps.push({ dx: 0, dy: by1 - ay2 });
  if (Math.abs(ay2 - by2) <= magnet) snaps.push({ dx: 0, dy: by2 - ay2 });

  if (Math.abs(ax1 - bx1) <= magnet) snaps.push({ dx: bx1 - ax1, dy: 0 });
  if (Math.abs(ax1 - bx2) <= magnet) snaps.push({ dx: bx2 - ax1, dy: 0 });
  if (Math.abs(ax2 - bx1) <= magnet) snaps.push({ dx: bx1 - ax2, dy: 0 });
  if (Math.abs(ax2 - bx2) <= magnet) snaps.push({ dx: bx2 - ax2, dy: 0 });

  if (!snaps.length)
    return { dx: 0, dy: 0, snapped: false, touching: false };

  snaps.sort(
      (p, q) => Math.hypot(p.dx, p.dy) - Math.hypot(q.dx, q.dy),
  );
  const best = snaps[0];
  const touching =
      Math.abs(best.dx) <= magnet && Math.abs(best.dy) <= magnet;
  return { dx: best.dx, dy: best.dy, snapped: true, touching };
}

function rectsTouching(a, b, eps = 1) {
  const ax1 = a.x,
      ay1 = a.y,
      ax2 = a.x + a.w,
      ay2 = a.y + a.h;
  const bx1 = b.x,
      by1 = b.y,
      bx2 = b.x + b.w,
      by2 = b.y + b.h;

  const hTouch =
      Math.abs(ax2 - bx1) <= eps ||
      Math.abs(bx2 - ax1) <= eps ||
      Math.abs(ax1 - bx1) <= eps ||
      Math.abs(ax2 - bx2) <= eps;
  const vTouch =
      Math.abs(ay2 - by1) <= eps ||
      Math.abs(by2 - ay1) <= eps ||
      Math.abs(ay1 - by1) <= eps ||
      Math.abs(ay2 - by2) <= eps;
  return hTouch || vTouch;
}

const STYLE_KEYS = [
  "w",
  "h",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "textCase",
  "letterSpacing",
  "fontColor",
  "textOpacity",
  "bgColor",
  "bgColor2",
  "bgMode",
  "bgOpacity",
  "gradientAngle",
  "borderColor",
  "borderOpacity",
  "borderWidth",
  "radius",
  "emboss",
  "glow",
  "innerBevelShadow",
  "innerBevelHighlight",
  "innerBevelSoftness",
  "hoverScale",
  "hoverLift",
  "hoverGlow",
  "hoverSpeed",
  "pressDepth",
  "pressScale",
  "rimLight",
  "shader",
  "titleEmboss",
  "fadeDuration",

  "hidden",
];

function pickStyleFields(src) {
  const out = {};
  if (!src) return out;
  STYLE_KEYS.forEach((k) => {
    if (src[k] !== undefined) out[k] = src[k];
  });
  return out;
}

// Built-in themes for quick epic looks
const BUILTIN_THEMES = {
  Glass: {
    bgMode: "linear",
    bgColor: "#020617",
    bgColor2: "#1d4ed8",
    bgOpacity: 0.9,
    gradientAngle: 145,
    borderColor: "#60a5fa",
    borderOpacity: 0.9,
    borderWidth: 1,
    radius: 18,
    emboss: 18,
    innerBevelShadow: 8,
    innerBevelHighlight: 4,
    innerBevelSoftness: 1.2,
    glow: 6,
    shader: "deepGlass",
    fontColor: "#e5e7eb",
    textOpacity: 1,
    fontWeight: 700,
    letterSpacing: 0.06,
    titleEmboss: false,
  },
  Neon: {
    bgMode: "solid",
    bgColor: "#020617",
    bgOpacity: 0.95,
    borderColor: "#38bdf8",
    borderOpacity: 0.9,
    borderWidth: 2,
    radius: 14,
    emboss: 10,
    innerBevelShadow: 4,
    innerBevelHighlight: 2,
    innerBevelSoftness: 1.1,
    glow: 18,
    shader: "sheen",
    fontColor: "#e0f2fe",
    textOpacity: 1,
    fontWeight: 800,
    letterSpacing: 0.08,
    hoverScale: 1.06,
    hoverGlow: 18,
    titleEmboss: true,
  },
  Soft: {
    bgMode: "solid",
    bgColor: "#1f2937",
    bgOpacity: 0.9,
    borderColor: "#4b5563",
    borderOpacity: 0.9,
    borderWidth: 1,
    radius: 20,
    emboss: 8,
    innerBevelShadow: 4,
    innerBevelHighlight: 2,
    innerBevelSoftness: 1.1,
    glow: 0,
    shader: "softPlastic",
    fontColor: "#f9fafb",
    textOpacity: 0.96,
    fontWeight: 600,
    letterSpacing: 0.02,
    titleEmboss: false,
  },
  Sunset: {
    bgMode: "radial",
    bgColor: "#f97316",
    bgColor2: "#ec4899",
    bgOpacity: 0.96,
    gradientAngle: 130,
    borderColor: "#fb923c",
    borderOpacity: 0.9,
    borderWidth: 1,
    radius: 22,
    emboss: 16,
    innerBevelShadow: 10,
    innerBevelHighlight: 5,
    innerBevelSoftness: 1.3,
    glow: 10,
    shader: "sheen",
    fontColor: "#fff7ed",
    textOpacity: 1,
    letterSpacing: 0.05,
    hoverScale: 1.05,
    hoverGlow: 16,
    titleEmboss: true,
  },
};

function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") return { r: 255, g: 255, b: 255 };
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b };
  }
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return { r, g, b };
  }
  return { r: 255, g: 255, b: 255 };
}

function rgbaFromHex(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  const a = clamp(isNaN(alpha) ? 1 : alpha, 0, 1);
  return `rgba(${r},${g},${b},${a})`;
}

export default function HudButtonsLayer({ uiHidden = false,  actions, setActions, runAction }) {
  // Config & persistence
  const [cfg, setCfg] = usePersistentState("epic3d.hudConfig.v1", {
    edit: false,
    snap: 1,
    magnet: 8,
  });
  // When the main UI is hidden (prodMode), force-disable edit mode
  React.useEffect(() => {
    if (!uiHidden) return;
    setCfg((prev) => (prev && prev.edit ? { ...prev, edit: false } : prev));
    // also clear any transient edit state so the toolbar / handles disappear
    setSelId(null);
    setDrag(null);
    setHoverId(null);
  }, [uiHidden, setCfg]);

  const [layout, setLayout] = usePersistentState(
      "epic3d.hudLayout.v3",
      {},
  );
  const [visibleMap, setVisibleMap] = usePersistentState(
      "epic3d.hudVisible.v1",
      {},
  );
  const [stylePresets, setStylePresets] = usePersistentState(
      "epic3d.hudStyles.v1",
      {},
  );

  const [selId, setSelId] = React.useState(null);
  const [soloMove, setSoloMove] = React.useState(false);
  const [drag, setDrag] = React.useState(null); // {id, kind, startX, startY, base, moved}
  const [hoverId, setHoverId] = React.useState(null);
  const [activeId, setActiveId] = React.useState(null);
  const [copiedStyle, setCopiedStyle] = React.useState(null);
  const [selectedPresetName, setSelectedPresetName] = React.useState("");
  const [newPresetName, setNewPresetName] = React.useState("");
  const [selectedTheme, setSelectedTheme] = React.useState("");

  const rContainer = React.useRef(null);
  const rPanel = React.useRef(null);

  const themeNames = Object.keys(BUILTIN_THEMES);

  // Sync layout defaults with actions
  React.useEffect(() => {
    if (!actions || !actions.length) return;
    setLayout((prev) => {
      const next = { ...prev };
      let changed = false;
      const vw =
          typeof window !== "undefined" ? window.innerWidth || 1280 : 1280;
      const vh =
          typeof window !== "undefined" ? window.innerHeight || 720 : 720;
      const margin = 16;
      const startX = Math.max(
          margin,
          Math.round(
              (vw - actions.length * (DEFAULT_BTN.w + 8)) / 2,
          ),
      );
      actions.forEach((a, i) => {
        if (!next[a.id]) {
          next[a.id] = {
            ...DEFAULT_BTN,
            x: startX + i * (DEFAULT_BTN.w + 8),
            y: vh - margin - DEFAULT_BTN.h,
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [actions, setLayout]);

  // Clean up removed actions
  React.useEffect(() => {
    setLayout((prev) => {
      if (!prev) return prev;
      const keep = new Set((actions || []).map((a) => a.id));
      const next = {};
      let changed = false;
      Object.keys(prev).forEach((id) => {
        if (keep.has(id)) next[id] = prev[id];
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [actions, setLayout]);

  // HUD fade / show-hide events
  React.useEffect(() => {
    function onFade(ev) {
      const { targetIds, mode, duration } = ev.detail || {};
      if (!Array.isArray(targetIds) || !targetIds.length) return;
      const fade = typeof duration === "number" && !Number.isNaN(duration)
          ? Math.max(0.01, duration)
          : null;

      if (fade != null) {
        setLayout((prev) => {
          const next = { ...prev };
          targetIds.forEach((id) => {
            if (!next[id]) next[id] = { ...DEFAULT_BTN };
            next[id] = { ...next[id], fadeDuration: fade };
          });
          return next;
        });
      }

      setVisibleMap((prev) => {
        const next = { ...prev };
        targetIds.forEach((id) => {
          next[id] = mode === "out" ? false : true;
        });
        return next;
      });
    }
    function onShowHide(ev) {
      const { targetIds, hidden } = ev.detail || {};
      if (!Array.isArray(targetIds)) return;
      setLayout((prev) => {
        const next = { ...prev };
        targetIds.forEach((id) => {
          if (next[id]) {
            next[id] = { ...next[id], hidden: !!hidden };
          }
        });
        return next;
      });
    }
    window.addEventListener("EPIC3D_HUD_FADE", onFade);
    window.addEventListener("EPIC3D_HUD_SHOWHIDE", onShowHide);
    return () => {
      window.removeEventListener("EPIC3D_HUD_FADE", onFade);
      window.removeEventListener("EPIC3D_HUD_SHOWHIDE", onShowHide);
    };
  }, [setLayout, setVisibleMap]);

  // Drag helpers
  // Drag helpers
  const startDrag = (e, id, kind) => {
    if (!cfg.edit) return;
    e.preventDefault();
    e.stopPropagation();

    const r = layout?.[id];
    if (!r) return;

    // Snapshot all button rects at drag start, so group moves keep relative offsets
    const bases = {};
    if (layout) {
      Object.entries(layout).forEach(([bid, rect]) => {
        bases[bid] = { ...rect };
      });
    }

    setSelId(id);
    setDrag({
      id,
      kind,
      startX: e.clientX,
      startY: e.clientY,
      base: { ...r }, // dragged button original rect
      bases,          // all buttons’ original rects
      moved: false,
    });
  };


  const onMove = (e) => {
    if (!drag) return;
    e.preventDefault();

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    const moved = drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
    setDrag((prev) => (prev ? { ...prev, moved } : prev));

    const margin = 16;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;

    const baseRect = drag.base;
    if (!baseRect) return;

    setLayout((prev) => {
      const cur = { ...prev };

      // 🔹 MOVE: only move the single dragged button, no grouping
      if (drag.kind === "move") {
        let nx = baseRect.x + dx;
        let ny = baseRect.y + dy;

        // Edge snap to other buttons
        const thisRect = { x: nx, y: ny, w: baseRect.w, h: baseRect.h };
        Object.entries(cur).forEach(([oid, r]) => {
          if (oid === drag.id || !r) return;
          const { dx: sdx, dy: sdy } = edgeSnap(
              thisRect,
              r,
              cfg.magnet || 8,
          );
          if (sdx || sdy) {
            nx += sdx;
            ny += sdy;
            thisRect.x += sdx;
            thisRect.y += sdy;
          }
        });

        // Optional grid snapping when edit mode uses snap > 1
        const grid = cfg.edit && (cfg.snap || 0) > 1 ? cfg.snap || 1 : 0;
        if (grid) {
          nx = Math.round(nx / grid) * grid;
          ny = Math.round(ny / grid) * grid;
        }

        // 🚫 Clamp so the whole button stays inside the viewport
        const maxX = vw - margin - baseRect.w;
        const maxY = vh - margin - baseRect.h;
        nx = clamp(nx, margin, maxX);
        ny = clamp(ny, margin, maxY);

        cur[drag.id] = { ...(cur[drag.id] || baseRect), x: nx, y: ny };
      }

      // 🔹 RESIZE: also clamp so resized button can’t grow off-screen
      if (drag.kind === "resize") {
        const stored = cur[drag.id] || baseRect;
        const minW = 80;
        const minH = 30;
        const maxW = vw - margin - stored.x;
        const maxH = vh - margin - stored.y;
        const nw = clamp(baseRect.w + dx, minW, maxW);
        const nh = clamp(baseRect.h + dy, minH, maxH);
        cur[drag.id] = { ...stored, w: nw, h: nh };
      }

      return cur;
    });
  };


  const endDrag = () => {
    if (!drag) return;
    // No more auto-grouping – just stop dragging
    setDrag(null);
  };

  // Run preview click from edit-mode when there was no drag
  const runActionRef = React.useRef(runAction);
  React.useEffect(() => {
    runActionRef.current = runAction;
  }, [runAction]);

  React.useEffect(() => {
    const onUp = () => {
      if (drag && cfg.edit && !drag.moved && runActionRef.current) {
        // Treat as a click in edit mode: select & preview
        const act = (actions || []).find((a) => a.id === drag.id);
        if (act) {
          setSelId(drag.id);
          runActionRef.current(act);
        }
      }
      setActiveId(null);
      endDrag();
    };
    const onMoveDoc = (e) => onMove(e);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMoveDoc, {
      passive: false,
    });
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMoveDoc);
    };
  });

  const selLayoutRaw = selId ? layout[selId] : null;
  const currentStyle = selLayoutRaw
      ? { ...DEFAULT_BTN, ...selLayoutRaw }
      : null;

  const patchSel = (patch) => {
    if (!selId) return;
    setLayout((prev) => ({
      ...prev,
      [selId]: { ...(prev[selId] || DEFAULT_BTN), ...patch },
    }));
  };

  const toggleHidden = (id) => {
    setLayout((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || DEFAULT_BTN),
        hidden: !prev[id]?.hidden,
      },
    }));
  };

  const recenterSelected = () => {
    if (!currentStyle || !selId) return;
    if (typeof window === "undefined") return;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const margin = 32;
    const x = clamp(
        vw / 2 - currentStyle.w / 2,
        margin,
        vw - margin - currentStyle.w,
    );
    const y = clamp(
        vh / 2 - currentStyle.h / 2,
        margin,
        vh - margin - currentStyle.h,
    );
    patchSel({ x, y });
  };

  const resetLayout = () => {
    if (!actions || !actions.length) return;
    const vw =
        typeof window !== "undefined" ? window.innerWidth || 1280 : 1280;
    const vh =
        typeof window !== "undefined" ? window.innerHeight || 720 : 720;
    const margin = 16;
    const startX = Math.max(
        margin,
        Math.round(
            (vw - actions.length * (DEFAULT_BTN.w + 8)) / 2,
        ),
    );
    const next = {};
    actions.forEach((a, i) => {
      next[a.id] = {
        ...DEFAULT_BTN,
        x: startX + i * (DEFAULT_BTN.w + 8),
        y: vh - margin - DEFAULT_BTN.h,
      };
    });
    setLayout(next);
  };
  // Allow the TopBar HUD section to drive this layer via window events
  React.useEffect(() => {
    function onHudConfig(ev) {
      const detail = ev.detail || {};
      setCfg((prev) => {
        const base = prev || { edit: false, snap: 1, magnet: 8 };
        const next = { ...base };
        if (typeof detail.edit === "boolean") next.edit = detail.edit;
        if (typeof detail.snap === "number" && !Number.isNaN(detail.snap)) {
          next.snap = detail.snap;
        }
        if (typeof detail.magnet === "number" && !Number.isNaN(detail.magnet)) {
          next.magnet = detail.magnet;
        }
        return next;
      });
    }

    function onHudReset() {
      resetLayout();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("EPIC3D_HUD_CONFIG", onHudConfig);
      window.addEventListener("EPIC3D_HUD_RESET_LAYOUT", onHudReset);
      return () => {
        window.removeEventListener("EPIC3D_HUD_CONFIG", onHudConfig);
        window.removeEventListener("EPIC3D_HUD_RESET_LAYOUT", onHudReset);
      };
    }
  }, [setCfg, resetLayout]);

  // Style editor position near selected button
  let panelLeft = 0;
  let panelTop = 0;
  if (currentStyle) {
    const vw =
        typeof window !== "undefined" ? window.innerWidth || 1280 : 1280;
    const vh =
        typeof window !== "undefined" ? window.innerHeight || 720 : 720;
    const rect =
        rPanel.current &&
        typeof rPanel.current.getBoundingClientRect === "function"
            ? rPanel.current.getBoundingClientRect()
            : null;
    const panelWidth = rect?.width || 420;
    const panelHeight = rect?.height || 320;
    const margin = 16;

    panelLeft = currentStyle.x + currentStyle.w + 12;
    panelTop = currentStyle.y;

    if (panelLeft + panelWidth > vw - margin) {
      panelLeft = currentStyle.x - panelWidth - 12;
    }
    if (panelLeft + panelWidth > vw - margin) {
      panelLeft = vw - margin - panelWidth;
    }
    if (panelLeft < margin) panelLeft = margin;

    if (panelTop + panelHeight > vh - margin) {
      panelTop = vh - margin - panelHeight;
    }
    if (panelTop < margin) panelTop = margin;
  }

  const buttonStyle = (r, hovered, active, editing) => {
    const base = { ...DEFAULT_BTN, ...r };
    const hoverScale = base.hoverScale ?? 1.02;
    const hoverLift = base.hoverLift ?? 0;
    const hoverGlow = base.hoverGlow ?? 0;
    const hoverSpeed = base.hoverSpeed ?? 0.18;
    const fadeDuration = base.fadeDuration ?? 0.35;
    const bgCol = rgbaFromHex(base.bgColor, base.bgOpacity ?? 1);
    const bgCol2 = rgbaFromHex(
        base.bgColor2 || base.bgColor,
        base.bgOpacity ?? 1,
    );
    const borderCol = rgbaFromHex(
        base.borderColor,
        base.borderOpacity ?? 1,
    );
    const textCol = rgbaFromHex(base.fontColor, base.textOpacity ?? 1);

    const bgModeRaw = base.bgMode || "solid";
    const bgMode =
        bgModeRaw === "gradient" ? "linear" : bgModeRaw;
    const angle =
        typeof base.gradientAngle === "number"
            ? base.gradientAngle
            : 135;

    let backgroundCore;
    if (bgMode === "solid") {
      backgroundCore = bgCol;
    } else if (bgMode === "radial") {
      const posX = 50 + 25 * Math.cos((angle * Math.PI) / 180);
      const posY = 50 + 25 * Math.sin((angle * Math.PI) / 180);
      backgroundCore = `radial-gradient(circle at ${posX}% ${posY}%, ${bgCol}, ${bgCol2})`;
    } else {
      backgroundCore = `linear-gradient(${angle}deg, ${bgCol}, ${bgCol2})`;
    }

    let background = backgroundCore;
    const shader = base.shader || "none";
    if (shader === "sheen") {
      background = `linear-gradient(120deg, rgba(255,255,255,0.18), transparent 40%), ${backgroundCore}`;
    } else if (shader === "deepGlass") {
      background = `linear-gradient(145deg, rgba(15,23,42,0.95), rgba(30,64,175,0.9)), radial-gradient(circle at 0% 0%, rgba(59,130,246,0.35), transparent 60%), ${backgroundCore}`;
    } else if (shader === "softPlastic") {
      background = `radial-gradient(circle at 15% 0%, rgba(255,255,255,0.12), transparent 55%), radial-gradient(circle at 85% 140%, rgba(15,23,42,0.85), rgba(15,23,42,0.98)), ${backgroundCore}`;
    }

    const embossBase = base.emboss ?? 12;
    const emboss = Math.max(
        0,
        embossBase - (active ? (base.pressDepth ?? 2) : 0),
    );

    const glow = base.glow ?? 0;
    const innerBevelShadow = base.innerBevelShadow ?? 0;
    const innerBevelHighlight = base.innerBevelHighlight ?? 0;
    const innerBevelSoftness = base.innerBevelSoftness ?? 1;
    const rimLight = base.rimLight ?? 0;

    const outerGlow =
        glow > 0
            ? `, 0 0 ${Math.round(glow * 2)}px rgba(56,189,248,0.7)`
            : "";
    const hoverExtra =
        hovered && hoverGlow > 0
            ? `, 0 0 ${Math.round(
                hoverGlow * 2,
            )}px rgba(251,191,36,0.75)`
            : "";


    let bevelShadow = "";
    if (innerBevelShadow > 0 || innerBevelHighlight > 0) {
      const s = Math.max(0.6, innerBevelSoftness);
      const sh = innerBevelShadow;
      const hi = innerBevelHighlight;
      bevelShadow =
          (sh > 0
              ? `, inset 0 ${sh}px ${sh * 2 * s}px rgba(0,0,0,0.7)`
              : "") +
          (hi > 0
              ? `, inset 0 -${Math.round(
                  hi * 0.6,
              )}px ${hi * 1.6 * s}px rgba(255,255,255,0.22)`
              : "");
    }

    const baseScale = hovered ? hoverScale : 1;
    const baseTranslateY = hovered ? -hoverLift : 0;

    const activeDepth = active ? (base.pressDepth ?? 2) : 0;
    const pressScale = active ? (base.pressScale ?? 0.97) : 1;


    const scale = baseScale * pressScale;
    const translateY = baseTranslateY + activeDepth;

    return {
      position: "absolute",
      left: base.x,
      top: base.y,
      width: base.w,
      height: base.h,
      transform: `translateY(${translateY}px) scale(${scale})`,

      transformOrigin: "center",
      borderRadius: base.radius,
      background,
      border: `${base.borderWidth != null ? base.borderWidth : 1}px solid ${borderCol}`,
      color: textCol,
      display: base.hidden ? "none" : "grid",
      placeItems: "center",
      fontWeight: base.fontWeight || 800,
      fontSize: base.fontSize || 13,
      fontFamily: base.fontFamily || DEFAULT_BTN.fontFamily,
      cursor: cfg.edit
          ? drag && drag.id === base.id
              ? "grabbing"
              : "grab"
          : "pointer",
      boxShadow:
          `inset 0 0 0 1px rgba(255,255,255,0.05), 0 ${emboss}px ${Math.round(
              emboss * 2,
          )}px rgba(0,0,0,0.6)` +
          outerGlow +
          hoverExtra +
          bevelShadow +
          (rimLight > 0
              ? `, 0 0 ${rimLight * 1.5}px rgba(255,255,255,0.28)`
              : ""),
      userSelect: "none",
      zIndex: base.z || 1,
      transition: `box-shadow ${hoverSpeed}s ease, transform ${hoverSpeed}s ease, opacity ${fadeDuration}s ease, background 0.25s ease`,

    };
  };

  const transformLabel = (label, style) => {
    if (!label) return "";
    if (style.textCase === "upper") return label.toUpperCase();
    if (style.textCase === "lower") return label.toLowerCase();
    return label;
  };

  return (
      <div
          ref={rContainer}
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 40,
          }}
          onPointerDown={(e) => e.stopPropagation()}
      >

        {cfg.edit && (
            <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  backgroundImage:
                      "linear-gradient(to right, rgba(15,23,42,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.45) 1px, transparent 1px)",
                  backgroundSize: `${Math.max(
                      4,
                      cfg.snap || 1,
                  )}px ${Math.max(4, cfg.snap || 1)}px`,
                  opacity: 0.4,
                }}
            />
        )}

        {/* Buttons */}
        {actions
            ?.filter((a) => a.showOnHUD ?? true)
            .map((a) => {
              const raw = layout[a.id] || DEFAULT_BTN;
              const style = { ...DEFAULT_BTN, ...raw, id: a.id };
              const fade = visibleMap[a.id] ?? true ? "in" : "out";
              const hovered = hoverId === a.id;

              return (
                  <div
                      key={a.id}
                      data-hud-id={a.id}
                      data-fade={fade}
                      style={{
                        ...buttonStyle(
                            style,
                            hovered,
                            activeId === a.id,
                            cfg.edit,
                        ),
                        pointerEvents:
                            style.hidden || fade === "out" ? "none" : "auto",
                        opacity: fade === "in" ? 1 : 0,
                      }}
                      onPointerEnter={() => setHoverId(a.id)}
                      onPointerLeave={() =>
                          setHoverId((id) => (id === a.id ? null : id))
                      }
                      onPointerDown={(e) => {
                        if (cfg.edit) {
                          startDrag(e, a.id, "move");
                        }
                        // Always set active for visual press feedback in both edit and normal modes
                        setActiveId(a.id);
                      }}

                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!cfg.edit) return;
                        setSoloMove((s) => !s);
                        setSelId(a.id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Always allow preview on click
                        if (cfg.edit) {
                          setSelId(a.id);
                        }
                        if (runAction) {
                          runAction(a);
                        }
                      }}
                  >
              <span
                  style={{
                    pointerEvents: "none",
                    textShadow: style.titleEmboss
                        ? "0 1px 0 rgba(0,0,0,0.9), 0 0 10px rgba(15,23,42,0.9)"
                        : "none",
                    letterSpacing: `${style.letterSpacing ?? 0.02}em`,
                    textTransform:
                        style.textCase === "upper"
                            ? "uppercase"
                            : style.textCase === "lower"
                                ? "lowercase"
                                : "none",
                    paddingInline: 10,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  }}
              >
                {transformLabel(a.label || "Action", style)}
              </span>

                    {/* Resize handle */}
                    {cfg.edit && (
                        <div
                            onPointerDown={(e) =>
                                startDrag(e, a.id, "resize")
                            }
                            style={{
                              position: "absolute",
                              right: 2,
                              bottom: 2,
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              background: "rgba(255,255,255,0.18)",
                              cursor: "nwse-resize",
                              boxShadow:
                                  "inset 0 0 0 1px rgba(0,0,0,0.4)",
                            }}
                        />
                    )}

                    {/* HUD icons while editing */}
                    {cfg.edit && (
                        <div
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 4,
                              display: "flex",
                              gap: 6,
                              pointerEvents: "auto",
                            }}
                        >
                          <button
                              title={style.hidden ? "Unhide" : "Hide"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleHidden(a.id);
                              }}
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 6,
                                border:
                                    "1px solid rgba(255,255,255,0.2)",
                                background: "rgba(0,0,0,0.4)",
                                color: "#fff",
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 900,
                              }}
                          >
                            {style.hidden ? "⏶" : "⏷"}
                          </button>
                        </div>
                    )}
                  </div>
              );
            })}

        {/* Style editor */}
        {cfg.edit && currentStyle && (
            <div
                ref={rPanel}
                style={{
                  position: "absolute",
                  left: panelLeft,
                  top: panelTop,
                  background:
                      "linear-gradient(180deg, rgba(24,32,56,0.97), rgba(15,23,42,0.96))",
                  border: "1px solid rgba(148,163,184,0.9)",
                  borderRadius: 14,
                  padding: 10,
                  color: "#e5e7eb",
                  minWidth: 420,
                  maxWidth: 520,
                  maxHeight: "72vh",
                  overflowY: "auto",
                  pointerEvents: "auto",
                  boxShadow: "0 18px 48px rgba(0,0,0,0.7)",
                }}
                onPointerDown={(e) => e.stopPropagation()}
            >
              <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
              >
                <div
                    style={{ fontWeight: 900, fontSize: 13 }}
                >
                  Button Style
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                      onClick={recenterSelected}
                      style={{
                        height: 24,
                        padding: "0 8px",
                        borderRadius: 999,
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        background: "rgba(15,23,42,0.9)",
                        color: "#e5e7eb",
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                  >
                    Recenter
                  </button>
                </div>
              </div>

              {/* Copy / presets / themes */}
              <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginBottom: 10,
                  }}
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                      onClick={() =>
                          setCopiedStyle(
                              pickStyleFields(currentStyle),
                          )
                      }
                      style={{
                        height: 28,
                        padding: "0 10px",
                        borderRadius: 999,
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        background: "rgba(15,23,42,0.9)",
                        color: "#e5e7eb",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                  >
                    Copy style
                  </button>
                  <button
                      disabled={!copiedStyle}
                      onClick={() => {
                        if (copiedStyle) patchSel(copiedStyle);
                      }}
                      style={{
                        height: 28,
                        padding: "0 10px",
                        borderRadius: 999,
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        background: copiedStyle
                            ? "rgba(59,130,246,0.3)"
                            : "rgba(15,23,42,0.85)",
                        color: copiedStyle
                            ? "#e5e7eb"
                            : "rgba(148,163,184,0.8)",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: copiedStyle
                            ? "pointer"
                            : "default",
                      }}
                  >
                    Paste style
                  </button>
                </div>

                {/* Presets */}
                <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 6,
                    }}
                >
              <span
                  style={{
                    fontSize: 11,
                    opacity: 0.85,
                  }}
              >
                Preset
              </span>
                  <select
                      value={selectedPresetName}
                      onChange={(e) =>
                          setSelectedPresetName(e.target.value)
                      }
                      style={{
                        height: 28,
                        borderRadius: 999,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  >
                    <option value="">(none)</option>
                    {Object.keys(stylePresets || {}).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                    ))}
                  </select>
                  <button
                      disabled={
                          !selectedPresetName ||
                          !stylePresets[selectedPresetName]
                      }
                      onClick={() => {
                        const st =
                            stylePresets[selectedPresetName];
                        if (st) patchSel(st);
                      }}
                      style={{
                        height: 28,
                        padding: "0 10px",
                        borderRadius: 999,
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        background:
                            selectedPresetName &&
                            stylePresets[selectedPresetName]
                                ? "rgba(34,197,94,0.85)"
                                : "rgba(15,23,42,0.85)",
                        color:
                            selectedPresetName &&
                            stylePresets[selectedPresetName]
                                ? "#022c22"
                                : "rgba(148,163,184,0.8)",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor:
                            selectedPresetName &&
                            stylePresets[selectedPresetName]
                                ? "pointer"
                                : "default",
                      }}
                  >
                    Apply
                  </button>
                  <input
                      placeholder="Save as..."
                      value={newPresetName}
                      onChange={(e) =>
                          setNewPresetName(e.target.value)
                      }
                      style={{
                        height: 28,
                        borderRadius: 999,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 10px",
                        fontSize: 12,
                        minWidth: 110,
                      }}
                  />
                  <button
                      onClick={() => {
                        const baseName =
                            newPresetName.trim() || "Style";
                        let name = baseName;
                        let idx = 1;
                        while (stylePresets[name]) {
                          name = `${baseName} ${idx++}`;
                        }
                        const st =
                            pickStyleFields(currentStyle);
                        setStylePresets((prev) => ({
                          ...(prev || {}),
                          [name]: st,
                        }));
                        setSelectedPresetName(name);
                        if (!newPresetName.trim())
                          setNewPresetName(name);
                      }}
                      style={{
                        height: 28,
                        padding: "0 10px",
                        borderRadius: 999,
                        border:
                            "1px solid rgba(59,130,246,1)",
                        background: "rgba(59,130,246,0.9)",
                        color: "#e5e7eb",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                  >
                    Save
                  </button>
                </div>

                {/* Themes */}
                <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 6,
                    }}
                >
              <span
                  style={{
                    fontSize: 11,
                    opacity: 0.85,
                  }}
              >
                Theme
              </span>
                  <select
                      value={selectedTheme}
                      onChange={(e) =>
                          setSelectedTheme(e.target.value)
                      }
                      style={{
                        height: 28,
                        borderRadius: 999,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  >
                    <option value="">(none)</option>
                    {themeNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                    ))}
                  </select>
                  <button
                      disabled={!selectedTheme}
                      onClick={() => {
                        const theme =
                            BUILTIN_THEMES[selectedTheme];
                        if (theme) patchSel(theme);
                      }}
                      style={{
                        height: 28,
                        padding: "0 10px",
                        borderRadius: 999,
                        border:
                            "1px solid rgba(34,211,238,1)",
                        background: selectedTheme
                            ? "rgba(34,211,238,0.95)"
                            : "rgba(15,23,42,0.85)",
                        color: selectedTheme
                            ? "#022c22"
                            : "rgba(148,163,184,0.8)",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: selectedTheme
                            ? "pointer"
                            : "default",
                      }}
                  >
                    Apply theme
                  </button>
                </div>
              </div>

              {/* Sections */}
              <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                        "repeat(2, minmax(0, 1fr))",
                    columnGap: 10,
                    rowGap: 6,
                  }}
              >
                {/* TEXT & LABEL */}
                <div
                    style={{
                      gridColumn: "1 / span 2",
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      opacity: 0.75,
                      marginTop: 2,
                    }}
                >
                  Text & Label
                </div>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Font size
                  <input
                      type="number"
                      min={8}
                      max={48}
                      value={currentStyle.fontSize || 13}
                      onChange={(e) =>
                          patchSel({
                            fontSize:
                                Number(e.target.value) || 13,
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Font weight
                  <input
                      type="number"
                      min={300}
                      max={900}
                      step={100}
                      value={currentStyle.fontWeight || 800}
                      onChange={(e) =>
                          patchSel({
                            fontWeight:
                                Number(e.target.value) || 800,
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Font (preset)
                  <select
                      value={
                          currentStyle.fontFamily ||
                          DEFAULT_BTN.fontFamily
                      }
                      onChange={(e) =>
                          patchSel({
                            fontFamily: e.target.value,
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 6px",
                        fontSize: 11,
                      }}
                  >
                    {FONT_OPTIONS.map((f) => (
                        <option
                            key={f.label}
                            value={f.value}
                        >
                          {f.label}
                        </option>
                    ))}
                  </select>
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Custom font stack
                  <input
                      type="text"
                      placeholder='e.g. "Orbitron", system-ui, sans-serif'
                      value={
                          currentStyle.fontFamily ||
                          DEFAULT_BTN.fontFamily
                      }
                      onChange={(e) =>
                          patchSel({
                            fontFamily: e.target.value,
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 11,
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Letter spacing (em)
                  <input
                      type="number"
                      step={0.01}
                      min={-0.1}
                      max={0.3}
                      value={
                          currentStyle.letterSpacing ??
                          0.02
                      }
                      onChange={(e) =>
                          patchSel({
                            letterSpacing:
                                Number(e.target.value) || 0,
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Text case
                  <select
                      value={currentStyle.textCase || "normal"}
                      onChange={(e) =>
                          patchSel({ textCase: e.target.value })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 6px",
                        fontSize: 12,
                      }}
                  >
                    <option value="normal">
                      Normal
                    </option>
                    <option value="upper">
                      UPPERCASE
                    </option>
                    <option value="lower">
                      lowercase
                    </option>
                  </select>
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Text color
                  <input
                      type="color"
                      value={
                        currentStyle.fontColor &&
                        currentStyle.fontColor.startsWith(
                            "#",
                        )
                            ? currentStyle.fontColor
                            : "#ffffff"
                      }
                      onChange={(e) =>
                          patchSel({ fontColor: e.target.value })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 4px",
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Text opacity
                  <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(
                          (currentStyle.textOpacity ?? 1) *
                          100,
                      )}
                      onChange={(e) =>
                          patchSel({
                            textOpacity:
                                Number(e.target.value) / 100,
                          })
                      }
                  />
                </label>

                {/* 3D & HOVER */}
                <div
                    style={{
                      gridColumn: "1 / span 2",
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      opacity: 0.75,
                      marginTop: 4,
                    }}
                >
                  3D & Hover
                </div>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Corner radius
                  <input
                      type="number"
                      min={0}
                      max={40}
                      value={currentStyle.radius || 14}
                      onChange={(e) =>
                          patchSel({
                            radius: Math.max(
                                0,
                                Number(e.target.value) || 14,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Depth (outer shadow)
                  <input
                      type="number"
                      min={0}
                      max={40}
                      value={currentStyle.emboss ?? 12}
                      onChange={(e) =>
                          patchSel({
                            emboss: Math.max(
                                0,
                                Number(e.target.value) || 12,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Outer glow
                  <input
                      type="number"
                      min={0}
                      max={40}
                      value={currentStyle.glow ?? 0}
                      onChange={(e) =>
                          patchSel({
                            glow: Math.max(
                                0,
                                Number(e.target.value) || 0,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Bevel shadow
                  <input
                      type="number"
                      min={0}
                      max={40}
                      value={
                          currentStyle.innerBevelShadow ?? 0
                      }
                      onChange={(e) =>
                          patchSel({
                            innerBevelShadow: Math.max(
                                0,
                                Number(e.target.value) || 0,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Bevel highlight
                  <input
                      type="number"
                      min={0}
                      max={40}
                      value={
                          currentStyle.innerBevelHighlight ??
                          0
                      }
                      onChange={(e) =>
                          patchSel({
                            innerBevelHighlight: Math.max(
                                0,
                                Number(e.target.value) || 0,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Bevel softness
                  <input
                      type="number"
                      step={0.1}
                      min={0.5}
                      max={2}
                      value={
                          currentStyle.innerBevelSoftness ?? 1
                      }
                      onChange={(e) =>
                          patchSel({
                            innerBevelSoftness: Math.min(
                                2,
                                Math.max(
                                    0.5,
                                    Number(e.target.value) || 1,
                                ),
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Rim light intensity
                  <input
                      type="number"
                      min={0}
                      max={24}
                      value={currentStyle.rimLight ?? 0}
                      onChange={(e) =>
                          patchSel({
                            rimLight: Math.max(
                                0,
                                Number(e.target.value) || 0,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Press depth (px)
                  <input
                      type="number"
                      min={0}
                      max={12}
                      value={currentStyle.pressDepth ?? 2}
                      onChange={(e) =>
                          patchSel({
                            pressDepth: Math.max(
                                0,
                                Number(e.target.value) || 2,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Press scale
                  <input
                      type="number"
                      step={0.01}
                      min={0.9}
                      max={1}
                      value={currentStyle.pressScale ?? 0.97}
                      onChange={(e) =>
                          patchSel({
                            pressScale: Math.min(
                                1,
                                Math.max(
                                    0.9,
                                    Number(e.target.value) || 0.97,
                                ),
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Hover scale
                  <input
                      type="number"
                      step={0.01}
                      min={0.8}
                      max={1.3}
                      value={
                          currentStyle.hoverScale ?? 1.04
                      }
                      onChange={(e) =>
                          patchSel({
                            hoverScale:
                                Number(e.target.value) || 1.04,
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Hover lift (px)
                  <input
                      type="number"
                      min={0}
                      max={16}
                      value={
                          currentStyle.hoverLift ?? 3
                      }
                      onChange={(e) =>
                          patchSel({
                            hoverLift: Math.max(
                                0,
                                Number(e.target.value) || 0,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Hover glow
                  <input
                      type="number"
                      min={0}
                      max={40}
                      value={
                          currentStyle.hoverGlow ?? 10
                      }
                      onChange={(e) =>
                          patchSel({
                            hoverGlow: Math.max(
                                0,
                                Number(e.target.value) || 0,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Hover speed (s)
                  <input
                      type="number"
                      step={0.02}
                      min={0.05}
                      max={0.5}
                      value={
                          currentStyle.hoverSpeed ?? 0.18
                      }
                      onChange={(e) =>
                          patchSel({
                            hoverSpeed: Math.max(
                                0.05,
                                Number(e.target.value) || 0.18,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Title emboss
                  <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                      }}
                  >
                    <input
                        type="checkbox"
                        checked={
                          !!currentStyle.titleEmboss
                        }
                        onChange={(e) =>
                            patchSel({
                              titleEmboss: e.target.checked,
                            })
                        }
                        style={{
                          width: 16,
                          height: 16,
                        }}
                    />
                    <span style={{ opacity: 0.85 }}>
                  Glow & depth on label text
                </span>
                  </div>
                </label>

                {/* BACKGROUND & FRAME / SHADER */}
                <div
                    style={{
                      gridColumn: "1 / span 2",
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      opacity: 0.75,
                      marginTop: 4,
                    }}
                >
                  Background, Frame & Shader
                </div>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Background type
                  <select
                      value={currentStyle.bgMode || "solid"}
                      onChange={(e) =>
                          patchSel({ bgMode: e.target.value })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 6px",
                        fontSize: 12,
                      }}
                  >
                    <option value="solid">Solid</option>
                    <option value="linear">
                      Linear gradient
                    </option>
                    <option value="radial">
                      Radial gradient
                    </option>
                  </select>
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Shader
                  <select
                      value={currentStyle.shader || "none"}
                      onChange={(e) =>
                          patchSel({ shader: e.target.value })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 6px",
                        fontSize: 12,
                      }}
                  >
                    <option value="none">None</option>
                    <option value="sheen">
                      Sheen highlight
                    </option>
                    <option value="deepGlass">
                      Deep glass
                    </option>
                    <option value="softPlastic">
                      Soft plastic
                    </option>
                  </select>
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Background
                  <input
                      type="color"
                      value={
                        currentStyle.bgColor &&
                        currentStyle.bgColor.startsWith(
                            "#",
                        )
                            ? currentStyle.bgColor
                            : "#1f2937"
                      }
                      onChange={(e) =>
                          patchSel({ bgColor: e.target.value })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 4px",
                      }}
                  />
                </label>

                {currentStyle.bgMode &&
                    currentStyle.bgMode !== "solid" && (
                        <>
                          <label
                              style={{
                                display: "grid",
                                gap: 4,
                              }}
                          >
                            Background 2
                            <input
                                type="color"
                                value={
                                  currentStyle.bgColor2 &&
                                  currentStyle.bgColor2.startsWith(
                                      "#",
                                  )
                                      ? currentStyle.bgColor2
                                      : "#3b82f6"
                                }
                                onChange={(e) =>
                                    patchSel({
                                      bgColor2: e.target.value,
                                    })
                                }
                                style={{
                                  height: 28,
                                  borderRadius: 8,
                                  background:
                                      "#020617",
                                  border:
                                      "1px solid rgba(148,163,184,0.9)",
                                  color: "#e5e7eb",
                                  padding: "0 4px",
                                }}
                            />
                          </label>
                          <label
                              style={{
                                display: "grid",
                                gap: 4,
                              }}
                          >
                            Gradient angle
                            <input
                                type="number"
                                min={0}
                                max={360}
                                value={
                                    currentStyle
                                        .gradientAngle ?? 135
                                }
                                onChange={(e) =>
                                    patchSel({
                                      gradientAngle:
                                          Number(
                                              e.target.value,
                                          ) || 135,
                                    })
                                }
                                style={{
                                  height: 28,
                                  borderRadius: 8,
                                  background:
                                      "#020617",
                                  border:
                                      "1px solid rgba(148,163,184,0.9)",
                                  color: "#e5e7eb",
                                  padding: "0 8px",
                                  fontSize: 12,
                                }}
                            />
                          </label>
                        </>
                    )}

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Background opacity
                  <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(
                          (currentStyle.bgOpacity ?? 1) *
                          100,
                      )}
                      onChange={(e) =>
                          patchSel({
                            bgOpacity:
                                Number(e.target.value) / 100,
                          })
                      }
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Border color
                  <input
                      type="color"
                      value={
                        currentStyle.borderColor &&
                        currentStyle.borderColor.startsWith(
                            "#",
                        )
                            ? currentStyle.borderColor
                            : "#4b5563"
                      }
                      onChange={(e) =>
                          patchSel({
                            borderColor: e.target.value,
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 4px",
                      }}
                  />
                </label>

                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Border width
                  <input
                      type="number"
                      min={0}
                      max={10}
                      value={
                          currentStyle.borderWidth ?? 1
                      }
                      onChange={(e) =>
                          patchSel({
                            borderWidth: Math.max(
                                0,
                                Number(e.target.value) || 1,
                            ),
                          })
                      }
                      style={{
                        height: 28,
                        borderRadius: 8,
                        background: "#020617",
                        border:
                            "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </label>
                <label
                    style={{ display: "grid", gap: 4 }}
                >
                  Border opacity
                  <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(
                          (currentStyle.borderOpacity ?? 1) *
                          100,
                      )}
                      onChange={(e) =>
                          patchSel({
                            borderOpacity:
                                Number(e.target.value) / 100,
                          })
                      }
                  />
                </label>

                {/* VISIBILITY */}
                <div
                    style={{
                      gridColumn: "1 / span 2",
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      opacity: 0.75,
                      marginTop: 4,
                    }}
                >
                  Visibility
                </div>

                {/* Fade duration control */}
                <div
                    style={{
                      gridColumn: "1 / span 2",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginTop: 4,
                    }}
                >
                  <span style={{ fontSize: 11, opacity: 0.8 }}>Fade duration (s)</span>
                  <input
                      type="number"
                      step={0.05}
                      min={0.01}
                      max={5}
                      value={currentStyle.fadeDuration ?? 0.35}
                      onChange={(e) =>
                          patchSel({
                            fadeDuration: Math.max(0.01, Number(e.target.value) || 0.35),
                          })
                      }
                      style={{
                        height: 28,
                        width: 80,
                        borderRadius: 8,
                        background: "#020617",
                        border: "1px solid rgba(148,163,184,0.9)",
                        color: "#e5e7eb",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                  />
                </div>

                {/* Hide / solo info row */}
                <div
                    style={{
                      gridColumn: "1 / span 2",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 4,
                    }}
                >
                  <button
                      onClick={() =>
                          patchSel({
                            hidden: !currentStyle.hidden,
                          })
                      }
                      style={{
                        height: 30,
                        padding: "0 12px",
                        borderRadius: 999,
                        border: "1px solid rgba(148,163,184,0.9)",
                        background: "rgba(15,23,42,0.9)",
                        color: "#e5e7eb",
                        fontWeight: 800,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                  >
                    {currentStyle.hidden ? "Unhide" : "Hide"} button
                  </button>
                  <div
                      style={{
                        fontSize: 11,
                        opacity: 0.8,
                      }}
                  >
                    Double-click button toggles solo group move
                  </div>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}

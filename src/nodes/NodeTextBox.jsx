// src/nodes/NodeTextBox.jsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";

// Small, safe markdown subset -> HTML (no images, no raw HTML)
function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function safeHref(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    if (s.startsWith("#")) return s;
    try {
        const u = new URL(
            s,
            typeof window !== "undefined" ? window.location.href : "https://example.invalid",
        );
        const p = (u.protocol || "").toLowerCase();
        if (p === "http:" || p === "https:" || p === "mailto:" || p === "tel:") return u.toString();
        return "";
    } catch {
        return "";
    }
}

function inlineMd(input) {
    let s = escapeHtml(input);

    // code spans
    s = s.replace(
        /`([^`]+)`/g,
        (_, a) =>
            `<code style="padding:0.05em 0.35em;border-radius:6px;background:rgba(255,255,255,0.12)">${a}</code>`,
    );

    // links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const safe = safeHref(href);
        if (!safe) return label;
        return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener" style="text-decoration:underline">${label}</a>`;
    });

    // bold / underline / strike / italic
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<u>$1</u>");
    s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");

    return s;
}

function markdownToHtml(md) {
    const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
    let html = "";
    let inUl = false;
    let inOl = false;
    let inCode = false;
    let codeBuf = [];

    const closeLists = () => {
        if (inUl) {
            html += "</ul>";
            inUl = false;
        }
        if (inOl) {
            html += "</ol>";
            inOl = false;
        }
    };

    const flushCode = () => {
        if (!inCode) return;
        const code = escapeHtml(codeBuf.join("\n"));
        html += `<pre style="margin:0.35em 0;padding:0.6em 0.7em;border-radius:10px;background:rgba(255,255,255,0.10);overflow:auto"><code>${code}</code></pre>`;
        inCode = false;
        codeBuf = [];
    };

    for (const rawLine of lines) {
        const line = rawLine ?? "";
        const trimmed = line.trim();

        // fenced code blocks
        if (trimmed.startsWith("```")) {
            closeLists();
            if (inCode) flushCode();
            else inCode = true;
            continue;
        }
        if (inCode) {
            codeBuf.push(line);
            continue;
        }

        // blank
        if (!trimmed) {
            closeLists();
            html += `<div style="height:0.5em"></div>`;
            continue;
        }

        // lists
        const ul = line.match(/^\s*[-*]\s+(.+)$/);
        const ol = line.match(/^\s*\d+\.\s+(.+)$/);

        if (ul) {
            if (inOl) {
                html += "</ol>";
                inOl = false;
            }
            if (!inUl) {
                html += `<ul style="margin:0.15em 0 0.35em 1.2em;padding:0">`;
                inUl = true;
            }
            html += `<li style="margin:0.15em 0">${inlineMd(ul[1])}</li>`;
            continue;
        }

        if (ol) {
            if (inUl) {
                html += "</ul>";
                inUl = false;
            }
            if (!inOl) {
                html += `<ol style="margin:0.15em 0 0.35em 1.2em;padding:0">`;
                inOl = true;
            }
            html += `<li style="margin:0.15em 0">${inlineMd(ol[1])}</li>`;
            continue;
        }

        closeLists();
        html += `<div style="margin:0.12em 0">${inlineMd(line)}</div>`;
    }

    closeLists();
    flushCode();
    return html;
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** Apply alpha multiplier to a CSS color and return rgba() when possible.
 * Supports: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba().
 * If parsing fails, returns the original color string.
 */

function applyAlpha(color, alphaMul) {
    const aMul = clamp01(alphaMul);
    const s = String(color ?? "").trim();
    if (!s) return `rgba(0,0,0,${aMul})`;

    // #rgb / #rrggbb / #rrggbbaa
    if (s[0] === "#") {
        let hex = s.slice(1).trim();
        if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const a0 = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
            const a = Math.max(0, Math.min(1, a0 * aMul));
            if ([r, g, b].every((x) => Number.isFinite(x))) return `rgba(${r},${g},${b},${a})`;
        }
        return s;
    }

    // rgb()/rgba()
    const m = s.match(/^rgba?\((.*)\)$/i);
    if (m) {
        const parts = m[1].split(",").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
            const r = Number(parts[0]);
            const g = Number(parts[1]);
            const b = Number(parts[2]);
            if ([r, g, b].every(Number.isFinite)) {
                const a0 = parts.length >= 4 ? Math.max(0, Math.min(1, Number(parts[3]) || 0)) : 1;
                const a = Math.max(0, Math.min(1, a0 * aMul));
                return `rgba(${r},${g},${b},${a})`;
            }
        }
    }

    return s;
}


export default function NodeTextBox({
                                        // visual / core
                                        enabled = true,
                                        text = "",
                                        mode = "billboard", // billboard | 3d | hud
                                        position = [0, 0, 0],

                                        // sizing (px)
                                        width = 320,
                                        height = 140,
                                        minWidth = 0,
                                        minHeight = 0,
                                        maxWidth = 0,
                                        maxHeight = 0,
                                        fitContent = false,

                                        // typography (px)
                                        fontSize = 16,
                                        color = "#ffffff",
                                        align = "left", // left | center | right
                                        wrap = "pre-wrap", // pre-wrap | normal | nowrap
                                        fontFamily = "",
                                        fontWeight = "normal",
                                        fontStyle = "normal",
                                        letterSpacing = 0,
                                        lineHeight = 1.4,

                                        // box style
                                        padding = 10,
                                        borderRadius = 10,
                                        bgColor = "#000000",
                                        bgOpacity = 0.6,
                                        borderWidth = 0,
                                        borderColor = "#ffffff",
                                        borderOpacity = 1,
                                        shadow = true,
                                        backdropBlur = 0,
                                        backdropSaturate = 100,

                                        // interaction
                                        // NOTE: default true so textbox can be clicked to select its node
                                        // (wheel is forwarded to the canvas so OrbitControls still works).
                                        allowPointerEvents = true,
                                        onSelect = null,
                                        forwardWheelToCanvas = true,

                                        // rich text
                                        richText = false,

                                        // auto scroll
                                        autoScroll = true,
                                        autoScrollSpeed = 0.4,

                                        // timers
                                        useTimers = false,
                                        fadeIn = 0,
                                        hold = 0,
                                        fadeOut = 0,

                                        // trigger channels
                                        autoTriggerId = 0,
                                        commandId = 0,
                                        commandType = null, // show | hide | fadeIn | fadeOut
                                        commandDuration = null,

                                        // Drei Html option
                                        distanceFactor = undefined,

                                        // parent opacity from node fade
                                        parentOpacity = 1,
                                    }) {
    const [opacity, setOpacity] = useState(enabled ? 1 : 0);
    const [fitSize, setFitSize] = useState({ w: 0, h: 0 });

    const outerRef = useRef(null);
    const scrollRef = useRef(null);
    const measureRef = useRef(null);
    const scrollDirRef = useRef(1);

    const nowMs = () =>
        typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

    // ----------------- visibility / fade logic -----------------
    useEffect(() => {
        let frameId;
        let active = true;

        const safeFadeIn = Math.max(0, Number(fadeIn || 0));
        const safeHold = Math.max(0, Number(hold || 0));
        const safeFadeOut = Math.max(0, Number(fadeOut || 0));

        if (!enabled) {
            setOpacity(0);
            return () => frameId && cancelAnimationFrame(frameId);
        }

        const runAutoSequence = () => {
            const total = safeFadeIn + safeHold + safeFadeOut;
            if (total <= 0) {
                setOpacity(1);
                return;
            }

            const start = nowMs();
            const tick = (tMs) => {
                if (!active) return;
                const t = (tMs - start) / 1000;

                if (safeFadeIn > 0 && t < safeFadeIn) {
                    setOpacity(t / safeFadeIn);
                } else if (t < safeFadeIn + safeHold || safeHold === 0) {
                    setOpacity(1);
                } else if (safeFadeOut > 0 && t < total) {
                    setOpacity(1 - (t - safeFadeIn - safeHold) / safeFadeOut);
                } else {
                    setOpacity(safeFadeOut > 0 ? 0 : 1);
                    return;
                }

                frameId = requestAnimationFrame(tick);
            };

            frameId = requestAnimationFrame(tick);
        };

        const runManualFade = (direction) => {
            const duration =
                commandDuration != null
                    ? Math.max(0, Number(commandDuration) || 0)
                    : direction === "in"
                        ? safeFadeIn
                        : safeFadeOut;

            if (duration <= 0) {
                setOpacity(direction === "in" ? 1 : 0);
                return;
            }

            const start = nowMs();
            const startOpacity = direction === "in" ? 0 : 1;
            const endOpacity = direction === "in" ? 1 : 0;

            setOpacity(startOpacity);

            const tick = (tMs) => {
                if (!active) return;
                const t = (tMs - start) / 1000;
                if (t < duration) {
                    const f = t / duration;
                    setOpacity(startOpacity + (endOpacity - startOpacity) * f);
                    frameId = requestAnimationFrame(tick);
                } else {
                    setOpacity(endOpacity);
                }
            };

            frameId = requestAnimationFrame(tick);
        };

        if (useTimers && autoTriggerId > 0) {
            runAutoSequence();
            return () => {
                active = false;
                frameId && cancelAnimationFrame(frameId);
            };
        }

        if (!useTimers && commandId > 0 && commandType) {
            const ct = String(commandType).toLowerCase();
            if (ct === "show") setOpacity(1);
            else if (ct === "hide") setOpacity(0);
            else if (ct === "fadein") runManualFade("in");
            else if (ct === "fadeout") runManualFade("out");

            return () => {
                active = false;
                frameId && cancelAnimationFrame(frameId);
            };
        }

        setOpacity(enabled ? 1 : 0);
        return () => frameId && cancelAnimationFrame(frameId);
    }, [enabled, useTimers, fadeIn, hold, fadeOut, autoTriggerId, commandId, commandType, commandDuration]);

    const effectiveOpacity = clamp01(opacity) * clamp01(parentOpacity);

    // ----------------- rich text html -----------------
    const richHtml = useMemo(() => {
        if (!richText) return null;
        return markdownToHtml(text);
    }, [richText, text]);

    // ----------------- fit-to-content measurement -----------------
    useLayoutEffect(() => {
        if (!fitContent) return;
        const el = measureRef.current;
        if (!el) return;

        let raf = 0;
        const update = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                if (!el) return;
                const r = el.getBoundingClientRect();
                if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) return;
                setFitSize({ w: r.width, h: r.height });
            });
        };

        update();

        let ro = null;
        try {
            // eslint-disable-next-line no-undef
            ro = new ResizeObserver(() => update());
            ro.observe(el);
        } catch {
            // ignore
        }

        window.addEventListener?.("resize", update);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener?.("resize", update);
            try { ro && ro.disconnect(); } catch {}
        };
    }, [fitContent, text, richText, fontSize, padding, wrap, align, maxWidth, maxHeight, minWidth, minHeight]);

    const wIn = Number(width) || 0;
    const hIn = Number(height) || 0;
    const minW = Math.max(0, Number(minWidth) || 0);
    const minH = Math.max(0, Number(minHeight) || 0);
    const maxW = Math.max(0, Number(maxWidth) || 0);
    const maxH = Math.max(0, Number(maxHeight) || 0);

    const measuredW = fitContent ? Math.ceil(fitSize.w) : 0;
    const measuredH = fitContent ? Math.ceil(fitSize.h) : 0;

    // If width/height are 0 => auto. If fitContent => use measured.
    const effectiveW = (wIn > 0 ? wIn : (fitContent && measuredW > 0 ? measuredW : undefined));
    const effectiveH = (hIn > 0 ? hIn : (fitContent && measuredH > 0 ? measuredH : undefined));

    // ----------------- auto scroll -----------------
    useEffect(() => {
        if (!autoScroll) return;
        if (allowPointerEvents) return;
        const el = scrollRef.current;
        if (!el) return;

        let raf = 0;
        let last = 0;

        const step = (t) => {
            if (!el) return;
            const dt = last ? (t - last) / 1000 : 0;
            last = t;

            const max = el.scrollHeight - el.clientHeight;
            if (max > 0) {
                const dir = scrollDirRef.current;
                const speed = Math.max(0, Number(autoScrollSpeed) || 0) * 60; // px/s-ish
                el.scrollTop = el.scrollTop + dir * speed * dt;
                if (el.scrollTop <= 0) {
                    el.scrollTop = 0;
                    scrollDirRef.current = 1;
                } else if (el.scrollTop >= max) {
                    el.scrollTop = max;
                    scrollDirRef.current = -1;
                }
            }

            raf = requestAnimationFrame(step);
        };

        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [autoScroll, autoScrollSpeed, text, richText]);

    // ----------------- wheel forwarding -----------------
    useEffect(() => {
        const el = outerRef.current;
        if (!el) return;

        const handler = (e) => {
            if (!allowPointerEvents) return;
            if (!forwardWheelToCanvas) return;

            // Hold SHIFT to scroll within textbox. Otherwise, forward to canvas (zoom)
            if (e.shiftKey) return;

            // prevent the HTML overlay from eating the wheel
            e.preventDefault();
            e.stopPropagation();

            const canvas = (() => {
                if (typeof document === "undefined") return null;
                // Prefer canvas near this Html overlay (drei portals to a wrapper div)
                const local = el.closest?.("div")?.querySelector?.("canvas");
                return local || document.querySelector("canvas");
            })();
            if (!canvas) return;

            const dispatch = (target) => {
                if (!target) return;
                try {
                    const evt = new WheelEvent("wheel", {
                        deltaX: e.deltaX,
                        deltaY: e.deltaY,
                        deltaZ: e.deltaZ,
                        deltaMode: e.deltaMode,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        screenX: e.screenX,
                        screenY: e.screenY,
                        ctrlKey: e.ctrlKey,
                        shiftKey: e.shiftKey,
                        altKey: e.altKey,
                        metaKey: e.metaKey,
                        bubbles: true,
                        cancelable: true,
                    });
                    target.dispatchEvent(evt);
                } catch {
                    // ignore
                }
            };

            dispatch(canvas);
            dispatch(canvas.parentElement);
            dispatch(typeof window !== "undefined" ? window : null);
        };

        // Must be non-passive so preventDefault works
        el.addEventListener("wheel", handler, { passive: false });
        return () => {
            try { el.removeEventListener("wheel", handler); } catch {}
        };
    }, [allowPointerEvents, forwardWheelToCanvas]);

    const handlePointerDownCapture = (e) => {
        if (!allowPointerEvents) return;
        try {
            e.stopPropagation();
        } catch {}
        if (typeof onSelect === "function") onSelect(e);
    };

    if (!enabled || effectiveOpacity <= 0.001) return null;

    const borderA = clamp01(borderOpacity);
    const resolvedBorderColor = borderWidth > 0 ? applyAlpha(borderColor, borderA) : "transparent";

    const nowrap = String(wrap).toLowerCase() === "nowrap";

    const computedBackdropFilter = (() => {
        const blur = Math.max(0, Number(backdropBlur) || 0);
        const sat = Math.max(0, Number(backdropSaturate) || 100);
        const parts = [];
        if (blur > 0) parts.push(`blur(${blur}px)`);
        if (sat !== 100) parts.push(`saturate(${sat}%)`);
        return parts.length ? parts.join(" ") : "none";
    })();

    const outerStyle = {
        width: effectiveW != null ? `${effectiveW}px` : "fit-content",
        height: effectiveH != null ? `${effectiveH}px` : "fit-content",
        minWidth: minW > 0 ? `${minW}px` : undefined,
        minHeight: minH > 0 ? `${minH}px` : undefined,
        maxWidth: maxW > 0 ? `${maxW}px` : undefined,
        maxHeight: maxH > 0 ? `${maxH}px` : undefined,

        pointerEvents: allowPointerEvents ? "auto" : "none",
        userSelect: allowPointerEvents ? "text" : "none",
        overscrollBehavior: "none",

        padding,
        borderRadius,
        boxSizing: "border-box",
        // background (with opacity)
        background: applyAlpha(bgColor, bgOpacity),

        // shadow + border
        boxShadow: shadow ? "0 8px 22px rgba(0,0,0,0.45)" : "none",
        border: borderWidth > 0 ? `${borderWidth}px solid ${resolvedBorderColor}` : "none",

        // typography
        color,
        fontSize,
        fontFamily: fontFamily || undefined,
        fontWeight: fontWeight || undefined,
        fontStyle: fontStyle || undefined,
        letterSpacing: Number(letterSpacing) || 0,
        lineHeight,
        textAlign: align,

        opacity: effectiveOpacity,
        backdropFilter: computedBackdropFilter,
        WebkitBackdropFilter: computedBackdropFilter,
    };

    const contentStyle = {
        width: "100%",
        height: effectiveH != null ? "100%" : "auto",
        overflowY: nowrap ? "hidden" : "auto",
        overflowX: nowrap ? "auto" : "hidden",
        whiteSpace: richText ? "normal" : wrap,
        textAlign: align,
    };

    const htmlProps = (() => {
        const m = String(mode || "billboard").toLowerCase();
        if (m === "3d") return { transform: true, sprite: false };
        if (m === "hud") return { transform: false, sprite: false };
        return { transform: true, sprite: true }; // billboard
    })();

    return (
        <>
            {/* hidden measurer for fit-content */}
                {fitContent && (
                    <Html position={position} style={{ pointerEvents: "none", opacity: 0 }}>
                        <div
                            ref={measureRef}
                            style={{
                                position: "absolute",
                                left: -100000,
                                top: -100000,
                                padding,
                                fontSize,
                                fontFamily: fontFamily || undefined,
                                fontWeight: fontWeight || undefined,
                                fontStyle: fontStyle || undefined,
                                letterSpacing: Number(letterSpacing) || 0,
                                lineHeight,
                                textAlign: align,
                                whiteSpace: richText ? "normal" : wrap,
                                maxWidth: maxW > 0 ? `${maxW}px` : undefined,
                                minWidth: minW > 0 ? `${minW}px` : undefined,
                                color: "#fff",
                            }}
                        >
                            {richText ? (
                                <div dangerouslySetInnerHTML={{ __html: richHtml || "" }} />
                            ) : (
                                <div>{text}</div>
                            )}
                        </div>
                    </Html>
                )}

                <Html
                    {...htmlProps}
                    position={position}
                    distanceFactor={distanceFactor}
                    // Let our wrapper decide pointer-events
                    pointerEvents={allowPointerEvents ? "auto" : "none"}
                >
                    <div
                        ref={outerRef}
                        onPointerDownCapture={handlePointerDownCapture}
                        style={outerStyle}
                    >
                        <div ref={scrollRef} style={contentStyle}>
                            {richText ? (
                                <div dangerouslySetInnerHTML={{ __html: richHtml || "" }} />
                            ) : (
                                text
                            )}
                        </div>
                    </div>
                </Html>
        </>
    );
}

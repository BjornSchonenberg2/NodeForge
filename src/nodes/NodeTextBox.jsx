// src/nodes/NodeTextBox.jsx
import React, { useEffect, useRef, useState } from "react";
import { Html } from "@react-three/drei";

/**
 * Floating text box bound to a node.
 *
 * Visual props (from node.textBox):
 *  - text, width, height, fontSize, bgColor, bgOpacity, color
 *  - mode: "billboard" | "3d" | "hud"
 *
 * Behaviour props:
 *  - enabled: boolean         -> whether this textbox should exist at all
 *  - useTimers: boolean       -> if true, use fadeIn/hold/fadeOut automatically
 *  - fadeIn, hold, fadeOut: seconds (0 = instant)
 *
 * Auto mode:
 *  - autoTriggerId: number    -> bump this to run a full fadeIn->hold->fadeOut once
 *
 * Manual mode (useTimers === false):
 *  - commandId: number        -> bump to execute a command
 *  - commandType: "show" | "hide" | "fadeIn" | "fadeOut"
 *  - commandDuration: number  -> seconds (optional; fallbacks to fadeIn/fadeOut)
 */
export default function NodeTextBox({
                                        // visual
                                        enabled = true,
                                        text = "",
                                        width = 300,
                                        height = 140,
                                        fontSize = 16,
                                        bgColor = "#000000",
                                        bgOpacity = 0.6,
                                        color = "#ffffff",
                                        mode = "billboard",
                                        position = [0, 0, 0],

                                        // timers
                                        useTimers = false,
                                        fadeIn = 0,
                                        hold = 0,
                                        fadeOut = 0,

                                        // auto sequence trigger
                                        autoTriggerId = 0,

                                        // manual control
                                        commandId = 0,
                                        commandType = null, // "show" | "hide" | "fadeIn" | "fadeOut"
                                        commandDuration = null,
                                    }) {
    const [opacity, setOpacity] = useState(enabled ? 1 : 0);
    const scrollRef = useRef(null);
    const scrollDirRef = useRef(1);

    const nowMs = () =>
        typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();

    // ----------------- MAIN VISIBILITY / FADE LOGIC -----------------
    useEffect(() => {
        let frameId;
        let active = true;

        const safeFadeIn = Math.max(0, fadeIn || 0);
        const safeHold = Math.max(0, hold || 0);
        const safeFadeOut = Math.max(0, fadeOut || 0);

        // If not enabled at all, just hide.
        if (!enabled) {
            setOpacity(0);
            return () => {
                if (frameId) cancelAnimationFrame(frameId);
            };
        }

        // Helper: run auto fadeIn -> hold -> fadeOut once
        const runAutoSequence = () => {
            const total = safeFadeIn + safeHold + safeFadeOut;
            // No timings: just fully visible
            if (total <= 0) {
                setOpacity(1);
                return;
            }

            const start = nowMs();
            const tick = (tMs) => {
                if (!active) return;
                const t = (tMs - start) / 1000;

                if (safeFadeIn > 0 && t < safeFadeIn) {
                    // fade in
                    setOpacity(t / safeFadeIn);
                } else if (t < safeFadeIn + safeHold || safeHold === 0) {
                    // hold
                    setOpacity(1);
                } else if (safeFadeOut > 0 && t < total) {
                    // fade out
                    setOpacity(1 - (t - safeFadeIn - safeHold) / safeFadeOut);
                } else {
                    // finished
                    setOpacity(safeFadeOut > 0 ? 0 : 1);
                    return;
                }

                frameId = requestAnimationFrame(tick);
            };

            frameId = requestAnimationFrame(tick);
        };

        // Helper: run manual fade in or out
        const runManualFade = (direction) => {
            const duration =
                commandDuration != null
                    ? Math.max(0, commandDuration)
                    : direction === "in"
                        ? safeFadeIn
                        : safeFadeOut;

            if (duration === 0) {
                setOpacity(direction === "in" ? 1 : 0);
                return;
            }

            const start = nowMs();
            const startOpacity = direction === "in" ? 0 : 1;
            const endOpacity = direction === "in" ? 1 : 0;

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

            // ensure starting opacity is correct
            setOpacity(startOpacity);
            frameId = requestAnimationFrame(tick);
        };

        // --------------- AUTO TIMER MODE ---------------
        if (useTimers && autoTriggerId > 0) {
            runAutoSequence();
            return () => {
                active = false;
                if (frameId) cancelAnimationFrame(frameId);
            };
        }

        // --------------- MANUAL MODE ---------------
        if (!useTimers && commandId > 0 && commandType) {
            if (commandType === "show") {
                setOpacity(1);
            } else if (commandType === "hide") {
                setOpacity(0);
            } else if (commandType === "fadeIn") {
                runManualFade("in");
            } else if (commandType === "fadeOut") {
                runManualFade("out");
            }

            return () => {
                active = false;
                if (frameId) cancelAnimationFrame(frameId);
            };
        }

        // Idle: respect enabled, no animation
        setOpacity(enabled ? 1 : 0);

        return () => {
            if (frameId) cancelAnimationFrame(frameId);
        };
    }, [
        enabled,
        useTimers,
        fadeIn,
        hold,
        fadeOut,
        autoTriggerId,
        commandId,
        commandType,
        commandDuration,
    ]);

    // ----------------- AUTO SCROLL FOR LONG TEXT -----------------
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        let frame;
        const step = () => {
            if (!el) return;
            if (el.scrollHeight > el.clientHeight) {
                el.scrollTop += scrollDirRef.current * 0.4;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
                    scrollDirRef.current = -1;
                } else if (el.scrollTop <= 0) {
                    scrollDirRef.current = 1;
                }
            }
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => frame && cancelAnimationFrame(frame);
    }, [text, width, height]);

    // ----------------- BACKGROUND COLOR WITH ALPHA -----------------
    const resolveBackground = () => {
        if (!bgColor) return "transparent";
        const hex = bgColor.replace("#", "");
        const alpha = Math.max(0, Math.min(1, bgOpacity ?? 1));
        if (hex.length === 6) {
            const a = Math.round(alpha * 255)
                .toString(16)
                .padStart(2, "0");
            return `#${hex}${a}`; // #rrggbbaa
        }
        return bgColor;
    };

    // ----------------- HTML POSITIONING MODE -----------------
    const htmlProps = { position };
    if (mode === "billboard") {
        htmlProps.sprite = true;
    } else if (mode === "3d") {
        htmlProps.transform = true;
    } // "hud" => plain Html at position

    return (
        <Html {...htmlProps}>
            <div
                style={{
                    opacity,
                    transition: "opacity 0.1s linear",
                    pointerEvents: "none",
                    background: resolveBackground(),
                    color,
                    width,
                    height,
                    fontSize,
                    overflow: "hidden",
                    borderRadius: 10,
                    padding: 10,
                    boxSizing: "border-box",
                    boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
                    display: opacity === 0 ? "none" : "block",
                    lineHeight: 1.4,
                    whiteSpace: "pre-wrap",
                }}
            >
                <div
                    ref={scrollRef}
                    style={{
                        width: "100%",
                        height: "100%",
                        overflowY: "auto",
                        overflowX: "hidden",
                    }}
                >
                    {text}
                </div>
            </div>
        </Html>
    );
}

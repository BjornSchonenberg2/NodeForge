import React from "react";
import { stop } from "../utils/dom";


export const Btn = ({
                        children,
                        onClick,
                        variant = "ghost",
                        disabled,
                        glow,
                        style,
                        title,
                        type = "button",   // 👈 allow caller to choose
                    }) => (
    <button
        type={type}       // 👈 use the type passed in
        title={title}
        disabled={!!disabled}
        onMouseDown={stop}
        onPointerDown={stop}
        onClick={(e) => { e.stopPropagation(); onClick && onClick(e); }}
        style={{
            padding: "9px 12px",
            borderRadius: 12,
            border: variant === "primary"
                ? "1px solid rgba(255,255,255,0.2)"
                : "1px solid rgba(255,255,255,0.12)",
            background: disabled
                ? "#2a2f3a"
                : variant === "primary"
                    ? "linear-gradient(180deg,#3a68ff,#2b47e5)"
                    : "rgba(255,255,255,0.06)",
            color: "#fff",
            boxShadow:
                variant === "primary"
                    ? `0 10px 24px rgba(58,104,255,0.35)${
                        glow ? ", 0 0 18px rgba(58,104,255,0.5)" : ""
                    }`
                    : "inset 0 0 0 1px rgba(255,255,255,0.03)",
            cursor: disabled ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 700,
            ...style,
        }}
    >
        {children}
    </button>
);


export const IconBtn = ({ label, onClick, title }) => (
  <button
    type="button"
    title={title || label}
    onMouseDown={stop}
    onPointerDown={stop}
    onClick={(e) => { stop(e); onClick && onClick(e); }}
    style={{
      width: 26, height: 26, display: "grid", placeItems: "center",
      borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer",
    }}
  >
    {label}
  </button>
);

export const Input = (props) => (
    <input
        {...props}
        onPointerDown={(e) => {
            e.stopPropagation();
            props.onPointerDown && props.onPointerDown(e);
        }}
        style={{
            boxSizing: "border-box",   // ✅ keep border + padding inside the container
            minWidth: 0,               // ✅ let it shrink nicely in grids/flex rows
            height: 32,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)",
            padding: "0 10px",
            color: "#fff",
            fontSize: 12,
            width: "100%",             // still full width, but now *contained*
            ...(props.style || {}),
        }}
    />
);


export const Select = (props) => (
  <select
    {...props}
    onPointerDown={(e) => { e.stopPropagation(); props.onPointerDown && props.onPointerDown(e); }}
    style={{
      height: 32, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.05)", padding: "0 10px", color: "#fff", fontSize: 12,
      width: "100%", ...(props.style || {}),
    }}
  />
);

export const Checkbox = ({ checked, onChange, label, style }) => (
  <label
    onPointerDown={stop}
    style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none", ...(style || {}) }}
  >
    <input
      type="checkbox" checked={!!checked} onClick={stop} onPointerDown={stop}
      onChange={(e) => onChange && onChange(e.target.checked)}
      style={{ width: 14, height: 14, accentColor: "#50E3C2" }}
    />
    {label && <span style={{ fontSize: 12 }}>{label}</span>}
  </label>
);

export const Slider = ({ value, min = 0, max = 1, step = 0.01, onChange }) => (
  <input type="range" value={value} min={min} max={max} step={step}
    onChange={(e) => onChange(Number(e.target.value))}
    onInput={(e) => onChange(Number(e.target.value))}
    onPointerDown={stop}
    style={{ width: "100%" }}
  />
);

export const Panel = ({ title, children }) => (
  <div onPointerDown={(e) => e.stopPropagation()} style={{
    background: "linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))",
    border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 12,
    backdropFilter: "blur(8px)", boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
    color: "#fff", pointerEvents: "auto",
  }}>
    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.3, marginBottom: 8 }}>{title}</div>
    <div style={{ fontSize: 12 }}>{children}</div>
  </div>
);

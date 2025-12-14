import React from "react";

export function Card({ children, className = "" }) {
    return <div className={`rounded-lg border border-gray-700 p-3 ${className}`}>{children}</div>;
}
export const CardHeader = ({ children, className = "" }) => (
    <div className={`mb-2 ${className}`}>{children}</div>
);
export const CardTitle = ({ children, className = "" }) => (
    <div className={`text-sm font-semibold ${className}`}>{children}</div>
);
export const CardContent = ({ children, className = "" }) => (
    <div className={className}>{children}</div>
);
// ui-shim.jsx
export function Button({ children, className = "", ...props }) {
    return (
        <button
            {...props}
            className={`px-3 py-2 rounded-md bg-gray-700 hover:bg-gray-600 text-sm ${className}`}
        >
            {children}
        </button>
    );
}

export function Input({ className = "", ...props }) {
    return (
        <input
            {...props}
            className={`w-full px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-sm ${className}`}
        />
    );
}


export const Label = ({ children, className = "" }) => (
    <label className={`text-xs ${className}`}>{children}</label>
);

export function Switch({ checked, onCheckedChange }) {
    return (
        <input
            type="checkbox"
            checked={!!checked}
            onChange={(e) => onCheckedChange?.(e.target.checked)}
        />
    );
}

export function Checkbox({ checked, onCheckedChange }) {
    return (
        <input
            type="checkbox"
            checked={!!checked}
            onChange={(e) => onCheckedChange?.(e.target.checked)}
        />
    );
}

export function Slider({ value = [0], min = 0, max = 100, step = 1, onValueChange }) {
    return (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onValueChange?.([+e.target.value])}
            style={{ width: "100%" }}
        />
    );
}

// Minimal <Select> that reads <SelectItem> children nested under <SelectContent>
export function Select({ value, onValueChange, children }) {
    const options = [];
    const dig = (kids) =>
        React.Children.forEach(kids, (child) => {
            if (!child) return;
            if (child.type?.displayName === "SelectItem") {
                options.push({ value: child.props.value, label: child.props.children });
            } else if (child.props?.children) {
                dig(child.props.children);
            }
        });
    dig(children);

    return (
        <select value={value} onChange={(e) => onValueChange?.(e.target.value)} className="w-full">
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    );
}
export const SelectContent = ({ children }) => <>{children}</>;
SelectContent.displayName = "SelectContent";
export const SelectItem = ({ children }) => <>{children}</>;
SelectItem.displayName = "SelectItem";
export const SelectTrigger = ({ children }) => <>{children}</>;
export const SelectValue = () => null;

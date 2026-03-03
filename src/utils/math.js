export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const snapValue = (v, step) => (step ? Math.round(v / step) * step : v);

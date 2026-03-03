import * as THREE from "three";

export const isWebGPUAvailable = () => false;

export async function createRenderer(props, options = {}) {
    const {
        antialias = true,
        alpha = false,
        depth = true,
        stencil = false,
        powerPreference = "high-performance",
    } = options;

    return new THREE.WebGLRenderer({
        ...props,
        antialias,
        alpha,
        depth,
        stencil,
        powerPreference,
    });
}

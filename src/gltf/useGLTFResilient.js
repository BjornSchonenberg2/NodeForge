// src/gltf/useGLTFResilient.js
import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { useThree } from "@react-three/fiber";

/** =========================
 *  Shared decoders / helpers
 *  ========================= */
let __sharedDraco; // single DRACO WASM instance reused across loads
function getSharedDraco(decoderPath) {
  if (!__sharedDraco) {
    __sharedDraco = new DRACOLoader();
    __sharedDraco.setDecoderPath(decoderPath || "https://www.gstatic.com/draco/v1/decoders/");
    __sharedDraco.setDecoderConfig({ type: "wasm" });
    __sharedDraco.preload();
  } else if (decoderPath) {
    // If caller asks for a specific path, keep the shared instance but update path (safe)
    __sharedDraco.setDecoderPath(decoderPath);
  }
  return __sharedDraco;
}

// Reuse one KTX2 loader per renderer (so detectSupport runs once)
const __ktx2ByRenderer = new WeakMap();
function getSharedKTX2(renderer, transcoderPath) {
  if (!renderer) return null;
  let ktx2 = __ktx2ByRenderer.get(renderer);
  if (!ktx2) {
    ktx2 = new KTX2Loader();
    ktx2
        .setTranscoderPath(
            transcoderPath ||
            // CDN: BasisU/ETC1S+UASTC (works well in production)
            "https://unpkg.com/three@0.160.0/examples/jsm/libs/basis/"
        )
        .detectSupport(renderer);
    __ktx2ByRenderer.set(renderer, ktx2);
  }
  return ktx2;
}

/** =========================
 *  Low-level resilient loader
 *  ========================= */
export async function loadGLTFFallback({
                                         url,
                                         urlModifier,
                                         dracoCandidates,
                                         renderer,             // WebGLRenderer from R3F (for KTX2 detectSupport)
                                         useKTX2 = true,
                                         useMeshopt = true,
                                         ktx2TranscoderPath,   // optional override for KTX2 transcoder
                                         resourcePath,         // optional: base path for external files referenced by .gltf
                                       }) {
  const candidates =
      Array.isArray(dracoCandidates) && dracoCandidates.length
          ? dracoCandidates
          : [
            `${process.env.PUBLIC_URL || ""}/draco/`,
            "/draco/",
            "https://www.gstatic.com/draco/v1/decoders/",
          ];

  return new Promise((resolve, reject) => {
    let i = 0;

    const tryLoad = () => {
      // Manager lets us inject a URL modifier (correct API point)
      const manager = new THREE.LoadingManager();
      if (urlModifier) manager.setURLModifier(urlModifier);

      const loader = new GLTFLoader(manager);
      if (resourcePath) loader.setResourcePath(resourcePath);

      // Optional accelerators
      if (useMeshopt && MeshoptDecoder) loader.setMeshoptDecoder(MeshoptDecoder);
      if (useKTX2 && renderer) {
        const ktx2 = getSharedKTX2(renderer, ktx2TranscoderPath);
        if (ktx2) loader.setKTX2Loader(ktx2);
      }

      // DRACO (try multiple decoder paths)
      const path = candidates[i] || "https://www.gstatic.com/draco/v1/decoders/";
      const draco = getSharedDraco(path);
      loader.setDRACOLoader(draco);

      // Load
      loader.load(
          url,
          (gltf) => resolve(gltf),
          undefined,
          (err) => {
            // Advance to next DRACO candidate if available
            if (i < candidates.length - 1) {
              i += 1;
              tryLoad();
            } else {
              reject(err);
            }
          }
      );
    };

    tryLoad();
  });
}

/** =========================
 *  React hook
 *  =========================
 *  descriptor: {
 *    url: string (required)
 *    urlModifier?: (url) => string
 *    dracoCandidates?: string[]
 *    ktx2TranscoderPath?: string
 *    resourcePath?: string
 *    cleanup?: () => void
 *  }
 */
export function useGLTFResilient(descriptor, onReady) {
  const { gl: renderer } = useThree(); // R3F WebGLRenderer (for KTX2 detectSupport)
  const [gltf, setGltf] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!descriptor?.url) return;

      try {
        const g = await loadGLTFFallback({
          url: descriptor.url,
          urlModifier: descriptor.urlModifier,
          dracoCandidates: descriptor.dracoCandidates,
          renderer, // enables KTX2 detection
          useKTX2: true,
          useMeshopt: true,
          ktx2TranscoderPath: descriptor.ktx2TranscoderPath,
          resourcePath: descriptor.resourcePath,
        });

        if (!cancelled) {
          setGltf(g);
          onReady && onReady(g.scene);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();

    return () => {
      cancelled = true;
      try {
        descriptor?.cleanup && descriptor.cleanup();
        // If you want aggressive cleanup, uncomment below:
        // if (gltf?.parser) gltf.parser.dispose();
        // gltf?.scene?.traverse((o) => {
        //   if (o.isMesh) {
        //     o.geometry?.dispose?.();
        //     const mats = Array.isArray(o.material) ? o.material : [o.material];
        //     mats.forEach((m) => {
        //       if (!m) return;
        //       m.map?.dispose?.();
        //       m.normalMap?.dispose?.();
        //       m.roughnessMap?.dispose?.();
        //       m.metalnessMap?.dispose?.();
        //       m.emissiveMap?.dispose?.();
        //       m.dispose?.();
        //     });
        //   }
        // });
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor?.url, descriptor?.urlModifier, descriptor?.ktx2TranscoderPath, descriptor?.resourcePath]);

  return { gltf, error };
}

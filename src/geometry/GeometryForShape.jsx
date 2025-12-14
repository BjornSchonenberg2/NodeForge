import React, { memo } from "react";

const GeometryForShape = memo(function GeometryForShape({ shape = {} }) {
  const type = (shape.type || "sphere").toLowerCase();

  switch (type) {
    case "box":
    case "square": {
      // scale: [x, y, z]
      return <boxGeometry args={shape.scale || [0.6, 0.3, 0.6]} />;
    }

    case "cylinder": {
      const r = shape.radius ?? 0.3;
      const h = shape.height ?? 0.6;
      const seg = shape.segments ?? 24;
      return <cylinderGeometry args={[r, r, h, seg]} />;
    }

    case "disc":
    case "circle": {
      // Flat cylinder (a “disc”)
      const r = shape.radius ?? 0.35;
      const h = shape.height ?? 0.08;
      const seg = shape.segments ?? 48;
      return <cylinderGeometry args={[r, r, h, seg]} />;
    }

    case "hexagon": {
      const r = shape.radius ?? 0.35;
      const h = shape.height ?? 0.5;
      return <cylinderGeometry args={[r, r, h, 6]} />;
    }

    case "cone": {
      const r = shape.radius ?? 0.35;
      const h = shape.height ?? 0.7;
      const seg = shape.segments ?? 24;
      return <coneGeometry args={[r, h, seg]} />;
    }

    case "switch": {
      // w/h/d are kept for your existing “switch” block shape
      const w = shape.w ?? 0.9;
      const h = shape.h ?? 0.12;
      const d = shape.d ?? 0.35;
      return <boxGeometry args={[w, h, d]} />;
    }

    case "sphere":
    default: {
      const r = shape.radius ?? 0.32;
      return <sphereGeometry args={[r, 32, 32]} />;
    }
  }
});

export default GeometryForShape;

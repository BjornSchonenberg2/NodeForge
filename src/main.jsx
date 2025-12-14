import React from "react";
import { createRoot } from "react-dom/client";
import Interactive3DNodeShowcase from "./Interactive3DNodeShowcase.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Interactive3DNodeShowcase />
  </React.StrictMode>
);

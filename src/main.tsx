import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

// Reset default body margin so the editor fills the viewport.
document.body.style.margin = "0";

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

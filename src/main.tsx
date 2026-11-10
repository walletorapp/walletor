import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";

import { App } from "./app/App";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";

const browserGlobals = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
};
browserGlobals.Buffer ??= Buffer;

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

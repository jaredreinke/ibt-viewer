import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * Application entry point.
 *
 * StrictMode is enabled in development to surface accidentally-unsafe
 * patterns (double-invocation of effects, legacy context, etc.). It is a
 * no-op in production builds.
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "@fontsource-variable/inter";
import "./styles.css";

// Copies made for playback (audio/playableCopy.js) are only needed while their file is open.
import("./audio/playableCopy.js").then((m) => m.clearPlayableCopies()).catch(() => {});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

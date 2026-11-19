import { createRoot } from "react-dom/client";
import { App } from "./app";
import "@pierre/words/styles.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(<App />);

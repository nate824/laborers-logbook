import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient } from "@/lib/queryClient";
import { setupOfflineMutations, setupOnlineManager } from "@/lib/offline";
import { registerServiceWorker } from "@/lib/offline/sw";

setupOnlineManager();
setupOfflineMutations(queryClient);
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);

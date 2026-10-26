import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { migrateLegacyStorage } from "./lib/legacy-storage";
import { createAppRouter } from "./router";

migrateLegacyStorage();

const router = createAppRouter();

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);

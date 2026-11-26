import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "@/web/router";

const root = document.getElementById("root");
if (!root) throw new Error("main.tsx: #root element missing in index.html");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

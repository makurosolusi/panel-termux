import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";

// Placeholder pages; the UI wave replaces them.
const PAGES = [
  { path: "/login", title: "Login" },
  { path: "/profile", title: "Profile" },
  { path: "/panel", title: "Panel" },
  { path: "/dev", title: "Dev" },
];

function Placeholder({ title }: { title: string }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {PAGES.map((p) => (
            <Button key={p.path} asChild variant="outline" size="sm">
              <Link to={p.path}>{p.title}</Link>
            </Button>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("main.tsx: #root element missing in index.html");
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {PAGES.map((p) => (
          <Route key={p.path} path={p.path} element={<Placeholder title={p.title} />} />
        ))}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

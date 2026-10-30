import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AdminRoute } from "./components/auth/AdminRoute";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { queryClient } from "./lib/query-client";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { LoginPage } from "./pages/LoginPage";
import { NoOrganizationPage } from "./pages/NoOrganizationPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

/**
 * Rutas de DocFlow (F1). Las pantallas S1–S10 son placeholders hasta su
 * fase. "documentos/nuevo" es estática y gana a "documentos/:docId" por
 * ranking del router. S3 (revisiones) es S2 con el filtro needs_review.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sin-organizacion" element={<NoOrganizationPage />} />
          <Route path="/o/:orgId" element={<ProtectedRoute />}>
            <Route index element={<PlaceholderPage title="Inicio" />} />
            <Route
              path="documentos"
              element={<PlaceholderPage title="Documentos" />}
            />
            <Route
              path="revisiones"
              element={<PlaceholderPage title="Revisiones pendientes" />}
            />
            <Route
              path="documentos/nuevo"
              element={<PlaceholderPage title="Carga de documento" />}
            />
            <Route
              path="documentos/:docId"
              element={<PlaceholderPage title="Revisión de documento" />}
            />
            <Route
              path="duplicados"
              element={<PlaceholderPage title="Duplicados" />}
            />
            <Route
              path="exportaciones"
              element={<PlaceholderPage title="Exportaciones" />}
            />
            <Route
              path="auditoria"
              element={<PlaceholderPage title="Auditoría" />}
            />
            <Route
              path="configuracion"
              element={<PlaceholderPage title="Configuración" />}
            />
            <Route
              path="configuracion/organizacion"
              element={<AdminRoute />}
            >
              <Route
                index
                element={
                  <PlaceholderPage title="Organización y permisos" />
                }
              />
            </Route>
          </Route>
          <Route path="/sin-permiso" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

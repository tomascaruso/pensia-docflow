import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { queryClient } from "./lib/query-client";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { LoginPage } from "./pages/LoginPage";
import { NoOrganizationPage } from "./pages/NoOrganizationPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { PendingReviewsPage } from "./pages/PendingReviewsPage";
import { UploadPage } from "./pages/UploadPage";
import { ReviewPage } from "./pages/ReviewPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { ExportsPage } from "./pages/ExportsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SettingsPage } from "./pages/SettingsPage";

/**
 * Rutas de DocFlow (F1). S2 y S3 son reales desde F4; el resto de las
 * pantallas S1–S10 son placeholders hasta su fase. "documentos/nuevo"
 * es estática y gana a "documentos/:docId" por ranking del router.
 * S3 (revisiones) es S2 con el filtro needs_review.
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
              element={
                <DocumentsPage
                  title="Documentos"
                  countNoun="documentos"
                  order="desc"
                  actionLabel="Ver"
                />
              }
            />
            <Route path="revisiones" element={<PendingReviewsPage />} />
            <Route path="documentos/nuevo" element={<UploadPage />} />
            <Route path="documentos/:docId" element={<ReviewPage />} />
            <Route path="duplicados" element={<DuplicatesPage />} />
            <Route
              path="exportaciones"
              element={<ExportsPage />}
            />
            <Route
              path="auditoria"
              element={<PlaceholderPage title="Auditoría" />}
            />
            <Route path="configuracion" element={<SettingsPage />} />
            <Route
              path="configuracion/organizacion"
              element={<OrganizationPage />}
            />
          </Route>
          <Route path="/sin-permiso" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

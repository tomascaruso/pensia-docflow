import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { DocumentStatus } from "@pensia-docflow/shared";
import { useOrg } from "../components/auth/OrgProvider";
import { BlockingBar, computeBlocking } from "../components/documents/BlockingBar";
import { ReviewStates } from "../components/documents/ReviewStates";
import { ReviewHeader } from "../components/documents/ReviewHeader";
import { DocumentViewer } from "../components/documents/DocumentViewer";
import { ReviewFields } from "../components/documents/ReviewFields";
import { ValidationPanel } from "../components/documents/ValidationPanel";
import { DuplicatePanel } from "../components/documents/DuplicatePanel";
import { HistoryPanel } from "../components/documents/HistoryPanel";
import { ApproveDialog } from "../components/documents/ApproveDialog";
import { RejectDialog } from "../components/documents/RejectDialog";
import { useDocumentDetail } from "../hooks/useDocumentDetail";
import { useDocuments } from "../hooks/useDocuments";
import { useDecide, type DecisionCorrection } from "../hooks/useDecide";
import { useResolveCandidate } from "../hooks/useResolveCandidate";

const NON_EDITABLE: DocumentStatus[] = [
  "processing",
  "failed",
  "blocked",
  "approved",
  "rejected",
];

/**
 * Página S5 Revisión (F6-B). Único punto donde vive la lógica de
 * estado de la pantalla; los componentes de P1 son presentacionales
 * (salvo ReviewStates, que cablea el reintento PD-13).
 *
 * Máquina de estados visual (spec §S5 "Estados del documento"):
 * - uploaded/queued → ReviewStates (null) + "Esperando procesamiento".
 * - processing/failed/blocked/approved/rejected → solo ReviewStates.
 * - needs_review → layout completo (header, barra, visor 55%,
 *   campos, validaciones, duplicados, historial, diálogos).
 *
 * R1: las correcciones son pendientes en cliente y viajan dentro
 * de POST /decisions al aprobar. R3: Anterior/Siguiente salen de
 * la query needs_review (order desc, primera página de 25); si el
 * documento no está en esa lista, ambos quedan deshabilitados.
 * canDecide es true: el permiso real lo impone el backend con 403
 * y la UI lo muestra como toast de error, sin pre-juzgar.
 */
export function ReviewPage() {
  const { orgId } = useOrg();
  const { docId } = useParams();
  const navigate = useNavigate();
  const detail = useDocumentDetail(orgId, docId ?? "");
  const pendingList = useDocuments(
    orgId,
    { status: "needs_review" },
    1,
    "desc",
  );
  const decide = useDecide(orgId, docId ?? "");
  const resolveCandidate = useResolveCandidate(orgId);
  const [pendingCorrections, setPendingCorrections] = useState<
    DecisionCorrection[]
  >([]);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  useEffect(() => {
    setPendingCorrections([]);
    setApproveOpen(false);
    setRejectOpen(false);
  }, [docId]);

  if (docId === undefined) {
    return <p>Documento no encontrado.</p>;
  }
  if (detail.isPending) {
    return <p>Cargando…</p>;
  }
  if (detail.isError || detail.data === undefined) {
    return <p>No se pudo cargar el documento.</p>;
  }

  const { document, fields, validations, candidates, decisions, jobs } =
    detail.data;
  const status = document.status;

  if (status === "uploaded" || status === "queued") {
    return (
      <div>
        <ReviewStates document={document} orgId={orgId} />
        <p>Esperando procesamiento.</p>
      </div>
    );
  }

  if (NON_EDITABLE.includes(status)) {
    const lastError =
      jobs.find((job) => job.lastError !== null)?.lastError ?? null;
    const decision = decisions.length > 0 ? decisions[decisions.length - 1] : null;
    return (
      <ReviewStates
        document={document}
        orgId={orgId}
        lastError={lastError}
        decision={decision ?? undefined}
      />
    );
  }

  // needs_review: layout completo.
  const blocking = computeBlocking(validations, candidates);
  const list = pendingList.data?.documents ?? [];
  const index = list.findIndex((item) => item.id === docId);
  const prev = index > 0 ? list[index - 1] : undefined;
  const next =
    index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;

  function goTo(id: string | undefined) {
    if (id !== undefined) {
      navigate(`/o/${orgId}/documentos/${id}`);
    }
  }

  function confirmApprove() {
    decide.mutate(
      { decision: "approved", corrections: pendingCorrections },
      {
        onSuccess: () => {
          toast.success("Documento aprobado.");
          setApproveOpen(false);
          setPendingCorrections([]);
        },
        onError: (error) => {
          toast.error(error.message);
        },
      },
    );
  }

  function confirmReject(justification: string) {
    decide.mutate(
      { decision: "rejected", justification },
      {
        onSuccess: () => {
          toast.success("Documento rechazado.");
          setRejectOpen(false);
        },
        onError: (error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <div>
      <ReviewHeader
        document={document}
        blocked={blocking.blocked}
        pendingCorrections={pendingCorrections.length}
        canDecide
        onApprove={() => setApproveOpen(true)}
        onReject={() => setRejectOpen(true)}
        onPrev={() => goTo(prev?.id)}
        onNext={() => goTo(next?.id)}
        prevDisabled={prev === undefined}
        nextDisabled={next === undefined}
      />
      <BlockingBar validations={validations} candidates={candidates} />
      <div>
        <DocumentViewer
          orgId={orgId}
          docId={document.id}
          fileName={document.fileName}
          mimeType={document.mimeType}
        />
        <ReviewFields
          fields={fields}
          pending={pendingCorrections}
          onChange={setPendingCorrections}
          readOnly={false}
        />
      </div>
      <ValidationPanel validations={validations} />
      <DuplicatePanel
        candidates={candidates}
        onResolve={(input) => {
          resolveCandidate.mutate(input, {
            onSuccess: () => {
              toast.success("Candidato resuelto.");
            },
            onError: (error) => {
              toast.error(error.message);
            },
          });
        }}
      />
      <HistoryPanel decisions={decisions} jobs={jobs} />
      <ApproveDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        pendingCorrections={pendingCorrections}
        onConfirm={confirmApprove}
        isPending={decide.isPending}
      />
      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onConfirm={confirmReject}
        isPending={decide.isPending}
      />
    </div>
  );
}

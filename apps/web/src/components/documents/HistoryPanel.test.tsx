import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type {
  DocumentDecision,
  ProcessingJob,
} from "@pensia-docflow/shared";
import { HistoryPanel } from "./HistoryPanel";

afterEach(() => {
  cleanup();
});

describe("HistoryPanel", () => {
  it("render decisiones con justificación", () => {
    const decisions: DocumentDecision[] = [
      {
        id: "dec-1",
        decidedBy: "user-9",
        decision: "rejected",
        justification: "Datos incorrectos",
        decidedAt: "2026-02-11T12:00:00.000Z",
      },
    ];
    render(<HistoryPanel decisions={decisions} jobs={[]} />);
    expect(screen.getByText(/Rechazado por user-9/)).toBeInTheDocument();
    expect(screen.getByText("Datos incorrectos")).toBeInTheDocument();
  });

  it("render jobs con intentos y error", () => {
    const jobs: ProcessingJob[] = [
      {
        id: "job-1",
        jobType: "extraction",
        status: "failed",
        attempts: 2,
        maxAttempts: 3,
        lastError: "El worker falló.",
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        createdAt: "2026-02-10T10:00:00.000Z",
      },
    ];
    render(<HistoryPanel decisions={[]} jobs={jobs} />);
    expect(screen.getByText(/Intento 2 de 3/)).toBeInTheDocument();
    expect(screen.getByText("El worker falló.")).toBeInTheDocument();
  });
});

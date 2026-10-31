import { Link } from "react-router-dom";
import {
  Database,
  HardDrive,
  Lock,
  Mail,
  ScanLine,
} from "lucide-react";

/**
 * S10 — Configuración (F3; F3.5 cards e íconos por integración).
 * Estática, sin endpoints: muestra los límites vigentes y el estado
 * honesto de las integraciones, con un link a S9. La fila de correo va
 * entera en gris: es la única integración no configurada y el texto
 * completo se mantiene en un solo nodo para no romper su lectura.
 */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-text">Configuración</h1>

      <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-text">
          Organización y permisos
        </h2>
        <Link
          to="organizacion"
          className="text-sm text-brand underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          Gestionar organización y permisos
        </Link>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-text">
          Límites y preferencias
        </h2>
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted">Tamaño máximo por documento:</dt>
            <dd>10 MB</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Páginas máximas por documento:</dt>
            <dd>20 páginas</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Tolerancia aritmética inicial:</dt>
            <dd>
              0,01{" "}
              <span className="text-muted">
                (Valor inicial configurable, no regla universal)
              </span>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Formato de fechas e importes:</dt>
            <dd>es-AR en pantalla, ISO en CSV y auditoría</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Filas por página en las listas:</dt>
            <dd>25</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Expiración de invitaciones:</dt>
            <dd>7 días</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Documentos por exportación:</dt>
            <dd>100</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-text">Integraciones</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li className="flex items-center gap-2">
            <ScanLine
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-slate-500"
            />
            OCR: OpenAI GPT-4o mini (configurado en B7)
          </li>
          <li className="flex items-center gap-2">
            <Lock
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-slate-500"
            />
            Autenticación: Better Auth (configurado en B1)
          </li>
          <li className="flex items-center gap-2">
            <HardDrive
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-slate-500"
            />
            Almacenamiento: local (configurado en B3)
          </li>
          <li className="flex items-center gap-2 text-slate-500">
            <Mail
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-slate-500"
            />
            Correo: no configurado (deuda, sin SMTP)
          </li>
          <li className="flex items-center gap-2">
            <Database
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-slate-500"
            />
            Base de datos: PostgreSQL local
          </li>
        </ul>
      </section>
    </div>
  );
}

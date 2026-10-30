/**
 * DocFlow B1 — Creación de organizaciones (Q1, Q2).
 *
 * Cadena especial (sin paso de membresía: la organización todavía
 * no existe): session (401) → platform_admin (403) → validación
 * del cuerpo (400) → handler.
 *
 * La creación inserta en AMBOS esquemas dentro de UNA sola
 * transacción Drizzle (mismo pool, misma base), con el MISMO id
 * UUID generado por el servicio:
 *   1. plugin `organization` (rol futuro: su `member` es `owner`),
 *   2. DocFlow `organizations` (mismo id),
 *   3. plugin `member` (role `owner`),
 *   4. DocFlow `organization_members` (role `org_admin`),
 *   5. auditoría M-03 `organization.created` (dentro de la misma
 *      transacción: el resolvedor ve la fila recién insertada).
 * Si cualquier paso falla, rollback total: nunca queda una org
 * del plugin sin org DocFlow ni viceversa (Q2).
 *
 * Por eso la creación NO pasa por el endpoint del plugin
 * (`organization/create`): ese endpoint corre fuera de nuestra
 * transacción y no puede garantizar atomicidad.
 *
 * Detalles de inserción (según el esquema generado por el CLI):
 * - `organization.slug` es NOT NULL UNIQUE: se genera desde el
 *   nombre + los primeros 8 caracteres del id (único aunque se
 *   repita el nombre).
 * - `organization.createdAt` y `member.createdAt` del plugin NO
 *   tienen default: se proveen explícitamente.
 * - DocFlow `organizations` usa `createdAt`/`updatedAt` y
 *   `organization_members` usa `joinedAt` (sin `updatedAt`).
 *
 * Validación del cuerpo: MANUAL en el handler, no con schema de
 * Fastify. Fastify valida los schemas en `preValidation`, ANTES
 * de los `preHandler`, y eso rompería la cadena (un no autorizado
 * recibiría 400 y aprendería la forma del cuerpo antes del 401 o
 * del 403). Un JSON malformado lo rechaza el parser de Fastify
 * antes de todo (inevitable: ni siquiera se puede leer el
 * request) y no revela nada.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  MemberRole,
  OrganizationCreateResponse,
  OrganizationDetailResponse,
  OrganizationsResponse,
} from "@pensia-docflow/shared";
import type { AuthSessionPort } from "../auth/session.js";
import * as schema from "../db/schema.js";
import * as authTables from "../auth/tables.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import type { PermissionAudit } from "../db/permission-service.js";
import { createDrizzleMembershipRepository } from "../db/permission-drizzle.js";
import {
  findOrganizationById,
  listOrganizationsOfUser,
  serializeOrganization,
} from "../db/read-drizzle.js";
import { getSession } from "../auth/session.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireSession } from "../middleware/require-session.js";
import {
  requirePlatformAdmin,
  type PlatformAdminDenial,
} from "../middleware/require-platform-admin.js";

export interface OrganizationStore {
  insertPluginOrganization(input: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
  }): Promise<void>;
  insertDocflowOrganization(input: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<void>;
  insertPluginMember(input: {
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    createdAt: Date;
  }): Promise<void>;
  insertDocflowMember(input: {
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    joinedAt: Date;
  }): Promise<void>;
}

export interface OrganizationDrizzleClient {
  insert(table: unknown): {
    values(values: Record<string, unknown>): Promise<unknown>;
  };
}

export function createDrizzleOrganizationStore(
  client: OrganizationDrizzleClient,
): OrganizationStore {
  return {
    async insertPluginOrganization(input) {
      await client.insert(authTables.organization).values({
        id: input.id,
        name: input.name,
        slug: input.slug,
        createdAt: input.createdAt,
      });
    },
    async insertDocflowOrganization(input) {
      await client.insert(schema.organizations).values({
        id: input.id,
        name: input.name,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      });
    },
    async insertPluginMember(input) {
      await client.insert(authTables.member).values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        createdAt: input.createdAt,
      });
    },
    async insertDocflowMember(input) {
      await client.insert(schema.organizationMembers).values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        joinedAt: input.joinedAt,
      });
    },
  };
}

/**
 * Slug para la tabla `organization` del plugin: base legible desde
 * el nombre + sufijo del id (único aunque se repita el nombre).
 */
export function slugifyOrganizationName(name: string, id: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org";
  return `${base}-${id.slice(0, 8)}`;
}

export interface CreateOrganizationDeps {
  store: OrganizationStore;
  audit: PermissionAudit;
}

export interface CreateOrganizationInput {
  /** Nombre ya validado (no vacío tras trim) por la ruta. */
  name: string;
  creatorUserId: string;
}

export async function createOrganization(
  deps: CreateOrganizationDeps,
  input: CreateOrganizationInput,
): Promise<{ id: string; name: string; createdAt: Date }> {
  const id = randomUUID();
  const now = new Date();
  await deps.store.insertPluginOrganization({
    id,
    name: input.name,
    slug: slugifyOrganizationName(input.name, id),
    createdAt: now,
  });
  await deps.store.insertDocflowOrganization({
    id,
    name: input.name,
    createdAt: now,
    updatedAt: now,
  });
  await deps.store.insertPluginMember({
    id: randomUUID(),
    organizationId: id,
    userId: input.creatorUserId,
    role: "owner",
    createdAt: now,
  });
  await deps.store.insertDocflowMember({
    id: randomUUID(),
    organizationId: id,
    userId: input.creatorUserId,
    role: "org_admin",
    joinedAt: now,
  });
  await deps.audit({
    actorId: input.creatorUserId,
    action: "organization.created",
    entityType: "organizations",
    entityId: id,
    details: {},
  });
  return { id, name: input.name, createdAt: now };
}

export interface RegisterOrganizationRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
  platformAdminEmails: string[];
  recordDenial?: (denial: PlatformAdminDenial) => Promise<void> | void;
}

export function registerOrganizationRoutes(
  app: FastifyInstance,
  deps: RegisterOrganizationRoutesDeps,
): void {
  app.post(
    "/organizations",
    {
      preHandler: [
        requireSession((request) => getSession(deps.auth, request)),
        requirePlatformAdmin({
          allowedEmails: deps.platformAdminEmails,
          recordDenial: deps.recordDenial,
        }),
      ],
    },
    async (request, reply) => {
      const body = request.body as unknown;
      const rawName =
        body !== null && typeof body === "object"
          ? (body as { name?: unknown }).name
          : undefined;
      if (typeof rawName !== "string") {
        return reply.code(400).send({
          error: "invalid_request",
          message: "El nombre de la organización es requerido.",
        });
      }
      const name = rawName.trim();
      if (name.length === 0) {
        return reply.code(400).send({
          error: "invalid_name",
          message: "El nombre de la organización no puede estar vacío.",
        });
      }
      const user = request.user;
      if (!user) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Sesión requerida.",
        });
      }
      const result = await deps.db.transaction(async (tx) => {
        return createOrganization(
          {
            store: createDrizzleOrganizationStore(tx),
            audit: (input) =>
              writeAuditEvent(
                {
                  resolver: createDrizzleAuditOrganizationResolver(tx),
                  store: createDrizzleAuditEventStore(tx),
                },
                input,
              ),
          },
          { name, creatorUserId: user.id },
        );
      });
      return reply.code(201).send({
        id: result.id,
        name: result.name,
        createdAt: result.createdAt.toISOString(),
        membership: { userId: user.id, role: "org_admin" },
      } satisfies OrganizationCreateResponse);
    },
  );

  const dbAudit = (input: Parameters<typeof writeAuditEvent>[1]) =>
    writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(deps.db),
        store: createDrizzleAuditEventStore(deps.db),
      },
      input,
    );
  const session = requireSession((request) => getSession(deps.auth, request));
  const membership = requireMembership({
    memberships: createDrizzleMembershipRepository(deps.db),
    pluginMembers: createDrizzlePluginMemberRepository(deps.db),
    audit: dbAudit,
    getOrgId: (request) =>
      (request.params as { id?: string }).id,
  });

  app.get(
    "/organizations/:id",
    { preHandler: [session, membership] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Sesión requerida.",
        });
      }
      const organizationId = (request.params as { id?: string }).id;
      if (organizationId === undefined) {
        return reply.code(404).send({
          error: "not_found",
          message: "Recurso no encontrado.",
        });
      }
      const org = await findOrganizationById(deps.db, organizationId);
      if (org === null) {
        return reply.code(404).send({
          error: "not_found",
          message: "Recurso no encontrado.",
        });
      }
      const role = request.membership?.role;
      return reply.code(200).send({
        ...serializeOrganization(org),
        membership: { role: role ?? null },
      } satisfies OrganizationDetailResponse);
    },
  );

  app.get(
    "/me/organizations",
    { preHandler: [session] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Sesión requerida.",
        });
      }
      const organizations = await listOrganizationsOfUser(deps.db, user.id);
      return reply.code(200).send({
        organizations: organizations.map((o) => ({
          ...o,
          role: o.role as MemberRole,
        })),
      } satisfies OrganizationsResponse);
    },
  );
}

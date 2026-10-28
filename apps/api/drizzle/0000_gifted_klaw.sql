CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"decided_by" text NOT NULL,
	"decision" text NOT NULL,
	"justification" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_decisions_decision_check" CHECK ("document_decisions"."decision" IN ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "document_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"extracted_value" text,
	"normalized_value" text,
	"confidence" numeric(5, 4),
	"source" text NOT NULL,
	"is_missing" boolean DEFAULT false NOT NULL,
	"is_uncertain" boolean DEFAULT false NOT NULL,
	"page_number" integer,
	"corrected_value" text,
	"corrected_by" text,
	"corrected_at" timestamp with time zone,
	"approved_value" text,
	CONSTRAINT "document_fields_confidence_check" CHECK ("document_fields"."confidence" IS NULL OR ("document_fields"."confidence" >= 0 AND "document_fields"."confidence" <= 1)),
	CONSTRAINT "document_fields_page_number_check" CHECK ("document_fields"."page_number" IS NULL OR "document_fields"."page_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"notes" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"field_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"exception_justification" text,
	"exception_accepted_by" text,
	"exception_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_validations_severity_check" CHECK ("document_validations"."severity" IN ('error', 'warning', 'info')),
	CONSTRAINT "document_validations_status_check" CHECK ("document_validations"."status" IN ('active', 'exception_accepted')),
	CONSTRAINT "document_validations_exception_check" CHECK ("document_validations"."status" <> 'exception_accepted' OR "document_validations"."exception_justification" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" char(64) NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"status" text NOT NULL,
	"supplier_name" text,
	"supplier_tax_id" text,
	"invoice_number" text,
	"issue_date" date,
	"currency" char(3),
	"total_amount" numeric(19, 4),
	"total_cents" bigint GENERATED ALWAYS AS (CASE WHEN "total_amount" IS NOT NULL AND "total_amount" = TRUNC("total_amount", 2) THEN ("total_amount" * 100)::bigint ELSE NULL END) STORED,
	"business_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" IN ('uploaded', 'queued', 'processing', 'needs_review', 'approved', 'rejected', 'failed', 'blocked')),
	CONSTRAINT "documents_size_bytes_check" CHECK ("documents"."size_bytes" > 0),
	CONSTRAINT "documents_page_count_check" CHECK ("documents"."page_count" IS NULL OR "documents"."page_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"candidate_document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason_code" text NOT NULL,
	"matched_fields_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"justification" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_candidates_kind_check" CHECK ("duplicate_candidates"."kind" IN ('business_exact', 'business_probable')),
	CONSTRAINT "duplicate_candidates_reason_check" CHECK ("duplicate_candidates"."reason_code" IN ('BUSINESS_EXACT', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6')),
	CONSTRAINT "duplicate_candidates_status_check" CHECK ("duplicate_candidates"."status" IN ('pending', 'distinct', 'duplicate', 'overridden')),
	CONSTRAINT "duplicate_candidates_distinct_check" CHECK ("duplicate_candidates"."document_id" <> "duplicate_candidates"."candidate_document_id"),
	CONSTRAINT "duplicate_candidates_justification_check" CHECK ("duplicate_candidates"."status" = 'pending' OR "duplicate_candidates"."justification" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "export_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"export_id" uuid NOT NULL,
	"document_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"main_file_name" text,
	"lines_file_name" text,
	"document_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_status_check" CHECK ("exports"."status" IN ('pending', 'completed', 'failed')),
	CONSTRAINT "exports_count_check" CHECK ("exports"."document_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "extraction_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"description" text,
	"quantity" numeric(19, 4),
	"unit_price" numeric(19, 4),
	"line_total" numeric(19, 4),
	CONSTRAINT "extraction_lines_number_check" CHECK ("extraction_lines"."line_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "member_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"permission_key" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "member_permissions_key_check" CHECK ("member_permissions"."permission_key" IN ('approve_documents', 'export_documents'))
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_role_check" CHECK ("organization_members"."role" IN ('org_admin', 'reviewer'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_not_empty" CHECK (char_length("organizations"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"idempotency_key" text,
	"last_error" text,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "processing_jobs_type_check" CHECK ("processing_jobs"."job_type" IN ('extraction')),
	CONSTRAINT "processing_jobs_status_check" CHECK ("processing_jobs"."status" IN ('pending', 'processing', 'completed', 'failed', 'blocked')),
	CONSTRAINT "processing_jobs_attempts_check" CHECK ("processing_jobs"."attempts" >= 0 AND "processing_jobs"."attempts" <= "processing_jobs"."max_attempts" AND "processing_jobs"."max_attempts" >= 1)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_decisions" ADD CONSTRAINT "document_decisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_fields" ADD CONSTRAINT "document_fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_validations" ADD CONSTRAINT "document_validations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_candidate_document_id_documents_id_fk" FOREIGN KEY ("candidate_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_items" ADD CONSTRAINT "export_items_export_id_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."exports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_items" ADD CONSTRAINT "export_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_lines" ADD CONSTRAINT "extraction_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permissions" ADD CONSTRAINT "member_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_decisions_document_unique" ON "document_decisions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_fields_document_field_unique" ON "document_fields" USING btree ("document_id","field_key");--> statement-breakpoint
CREATE INDEX "document_fields_document_idx" ON "document_fields" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_reviews_document_idx" ON "document_reviews" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_validations_document_status_idx" ON "document_validations" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX "documents_org_status_idx" ON "documents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "documents_org_file_hash_idx" ON "documents" USING btree ("organization_id","file_hash");--> statement-breakpoint
CREATE INDEX "documents_org_business_key_idx" ON "documents" USING btree ("organization_id","business_key") WHERE "documents"."business_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_org_created_idx" ON "documents" USING btree ("organization_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "documents_org_supplier_number_idx" ON "documents" USING btree ("organization_id","supplier_name","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidates_pair_unique" ON "duplicate_candidates" USING btree ("document_id","candidate_document_id");--> statement-breakpoint
CREATE INDEX "duplicate_candidates_document_status_idx" ON "duplicate_candidates" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX "duplicate_candidates_candidate_status_idx" ON "duplicate_candidates" USING btree ("candidate_document_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "export_items_export_document_unique" ON "export_items" USING btree ("export_id","document_id");--> statement-breakpoint
CREATE INDEX "export_items_export_idx" ON "export_items" USING btree ("export_id");--> statement-breakpoint
CREATE INDEX "exports_org_created_idx" ON "exports" USING btree ("organization_id","created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_lines_document_line_unique" ON "extraction_lines" USING btree ("document_id","line_number");--> statement-breakpoint
CREATE INDEX "extraction_lines_document_idx" ON "extraction_lines" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "member_permissions_org_user_idx" ON "member_permissions" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_permissions_active_unique_idx" ON "member_permissions" USING btree ("organization_id","user_id","permission_key") WHERE "member_permissions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "organization_members_organization_idx" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_unique" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "processing_jobs_status_scheduled_idx" ON "processing_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "processing_jobs_document_idx" ON "processing_jobs" USING btree ("document_id");
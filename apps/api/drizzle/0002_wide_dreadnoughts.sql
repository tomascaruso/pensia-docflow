ALTER TABLE "exports" ADD COLUMN "format" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "selection_filters" jsonb;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_format_check" CHECK ("exports"."format" = 'csv');
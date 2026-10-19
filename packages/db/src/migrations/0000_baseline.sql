CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TABLE IF NOT EXISTS "schema_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" varchar(64) NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO "schema_version" ("id", "version", "applied_at")
VALUES ('018f0000-0000-7000-8000-000000000001', '0000_baseline', now())
ON CONFLICT ("id") DO NOTHING;

-- DocFlow H2 — Verificación del esquema H1 en PostgreSQL real.
--
-- Uso (solo contra la base local autorizada):
--   DATABASE_URL=postgresql://usuario@127.0.0.1:5432/docflow_dev npm run db:verify
--
-- Propiedades de seguridad del script:
--   * La invocación vía `npm run db:verify` antepone la puerta
--     `check-destination.ts`, que rechaza destinos no autorizados ANTES
--     de invocar `psql` (sin abrir ninguna conexión).
--   * Tras conectar, la sección 0 valida el destino REAL según el propio
--     servidor: current_database() = 'docflow_dev' Y servidor local
--     (inet_server_addr() nulo para socket local, o 127.0.0.1 / ::1 para
--     TCP local). No confía en el nombre de la base ni en el texto de
--     DATABASE_URL. Si falla, el script aborta antes de cualquier sonda
--     de escritura.
--   * No deja residuos: cada sonda que escribe lo hace dentro de un bloque
--     DO que inserta, verifica y borra en la misma transacción, o dentro
--     de un sub-bloque que falla (rollback parcial) cuando se espera un
--     rechazo. Las comprobaciones de solo lectura son SELECT.
--   * Con ON_ERROR_STOP=1, cualquier resultado inesperado (una sonda que
--     no es rechazada, un conteo distinto, una aserción fallida) aborta
--     el script con error: un PASS silencioso es imposible.
--   * Las secciones 7.x NO son PASS de los controles A-01/A-02/M-01/M-02/
--     M-03: demuestran que la base NO impide esos casos y que, por tanto,
--     esos controles siguen pendientes de lógica de aplicación.

\set ON_ERROR_STOP on

-- 0. Guarda de destino (post-conexión, antes de cualquier escritura) ---------
-- inet_server_addr() es NULL para conexiones por socket local (mismo host
-- por definición) y la IP del servidor para TCP. Solo se acepta socket
-- local, 127.0.0.1 o ::1. Un túnel local hacia una base remota pasaría
-- esta comprobación (el endpoint TCP es loopback): ver riesgo residual
-- documentado en el informe de la corrección.
DO $$
BEGIN
  IF current_database() <> 'docflow_dev' THEN
    RAISE EXCEPTION 'verify: base no autorizada: % (se esperaba docflow_dev)', current_database();
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
    RAISE EXCEPTION 'verify: servidor no local: % (se esperaba socket local, 127.0.0.1 o ::1)', inet_server_addr();
  END IF;
  RAISE NOTICE 'PASS 0: destino real verificado (base docflow_dev, servidor local %)',
    COALESCE(inet_server_addr()::text, '(socket local)');
END $$;

-- 1. Conteos de seeds ---------------------------------------------------------
DO $$
DECLARE
  v_orgs int; v_members int; v_perms int; v_perms_active int; v_docs int;
  v_fields int; v_lines int; v_vals int; v_cands int; v_jobs int;
  v_reviews int; v_decs int; v_audit int; v_exports int; v_items int;
BEGIN
  SELECT count(*) INTO v_orgs FROM organizations;
  SELECT count(*) INTO v_members FROM organization_members;
  SELECT count(*) INTO v_perms FROM member_permissions;
  SELECT count(*) INTO v_perms_active FROM member_permissions WHERE revoked_at IS NULL;
  SELECT count(*) INTO v_docs FROM documents;
  SELECT count(*) INTO v_fields FROM document_fields;
  SELECT count(*) INTO v_lines FROM extraction_lines;
  SELECT count(*) INTO v_vals FROM document_validations;
  SELECT count(*) INTO v_cands FROM duplicate_candidates;
  SELECT count(*) INTO v_jobs FROM processing_jobs;
  SELECT count(*) INTO v_reviews FROM document_reviews;
  SELECT count(*) INTO v_decs FROM document_decisions;
  SELECT count(*) INTO v_audit FROM audit_events;
  SELECT count(*) INTO v_exports FROM exports;
  SELECT count(*) INTO v_items FROM export_items;
  IF v_orgs <> 2 OR v_members <> 4 OR v_perms <> 3 OR v_perms_active <> 2
     OR v_docs <> 14 OR v_fields <> 8 OR v_lines <> 3 OR v_vals <> 5
     OR v_cands <> 3 OR v_jobs <> 4 OR v_reviews <> 4 OR v_decs <> 3
     OR v_audit <> 8 OR v_exports <> 2 OR v_items <> 2 THEN
    RAISE EXCEPTION 'FAIL conteos: orgs=% members=% perms=% (activos=%) docs=% fields=% lines=% vals=% cands=% jobs=% reviews=% decs=% audit=% exports=% items=%',
      v_orgs, v_members, v_perms, v_perms_active, v_docs, v_fields, v_lines, v_vals, v_cands, v_jobs, v_reviews, v_decs, v_audit, v_exports, v_items;
  END IF;
  RAISE NOTICE 'PASS 1: conteos de seeds exactos (orgs=2, docs=14, candidatos=3, exportaciones=2, etc.)';
END $$;

-- 1b. Distribución de estados y candidatos ------------------------------------
DO $$
DECLARE
  v_needs int; v_appr int; v_rej int; v_exact_pend int; v_p1_pend int; v_exact_dup int;
BEGIN
  SELECT count(*) INTO v_needs FROM documents WHERE status = 'needs_review';
  SELECT count(*) INTO v_appr FROM documents WHERE status = 'approved';
  SELECT count(*) INTO v_rej FROM documents WHERE status = 'rejected';
  SELECT count(*) INTO v_exact_pend FROM duplicate_candidates WHERE reason_code = 'BUSINESS_EXACT' AND status = 'pending';
  SELECT count(*) INTO v_p1_pend FROM duplicate_candidates WHERE reason_code = 'P1' AND status = 'pending';
  SELECT count(*) INTO v_exact_dup FROM duplicate_candidates WHERE reason_code = 'BUSINESS_EXACT' AND status = 'duplicate';
  IF v_needs <> 6 OR v_appr <> 2 OR v_rej <> 1 OR v_exact_pend <> 1 OR v_p1_pend <> 1 OR v_exact_dup <> 1 THEN
    RAISE EXCEPTION 'FAIL estados/candidatos: needs=% appr=% rej=% exact_pend=% p1_pend=% exact_dup=%',
      v_needs, v_appr, v_rej, v_exact_pend, v_p1_pend, v_exact_dup;
  END IF;
  RAISE NOTICE 'PASS 1b: estados (needs_review=6, approved=2, rejected=1) y candidatos (exacto pendiente, P1 pendiente, exacto resuelto) exactos';
END $$;

-- 2. Estructura: 14 tablas, 15 FK, índices parciales y únicos -----------------
DO $$
DECLARE
  v_tables int; v_fk int; v_partial int;
BEGIN
  SELECT count(*) INTO v_tables FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  SELECT count(*) INTO v_fk FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
  SELECT count(*) INTO v_partial FROM pg_indexes
    WHERE schemaname = 'public' AND indexdef LIKE '%WHERE%';
  IF v_tables <> 14 THEN RAISE EXCEPTION 'FAIL tablas: % (se esperaban 14)', v_tables; END IF;
  IF v_fk <> 15 THEN RAISE EXCEPTION 'FAIL FK: % (se esperaban 15)', v_fk; END IF;
  IF v_partial < 2 THEN RAISE EXCEPTION 'FAIL índices parciales: % (se esperaban al menos 2)', v_partial; END IF;
  RAISE NOTICE 'PASS 2: 14 tablas, 15 FK, % índices parciales (clave de negocio, permisos activos)', v_partial;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'member_permissions_active_unique_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: falta member_permissions_active_unique_idx'; END IF;
  PERFORM 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'documents_org_business_key_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: falta documents_org_business_key_idx'; END IF;
  PERFORM 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'duplicate_candidates_pair_unique';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: falta duplicate_candidates_pair_unique'; END IF;
  PERFORM 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'document_decisions_document_unique';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: falta document_decisions_document_unique'; END IF;
  PERFORM 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'processing_jobs_idempotency_key_unique';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: falta processing_jobs_idempotency_key_unique'; END IF;
  RAISE NOTICE 'PASS 2b: índices únicos y parciales esperados presentes';
END $$;

-- 3. Columna generada total_cents ----------------------------------------------
DO $$
DECLARE
  v_cents bigint; v_probe uuid := '90000000-0000-4000-8000-000000000001';
  v_org uuid := '10000000-0000-4000-8000-000000000001';
  v_hash char(64) := 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1';
BEGIN
  INSERT INTO documents (id, organization_id, file_name, file_hash, mime_type, size_bytes, status, total_amount)
    VALUES (v_probe, v_org, 'sonda.pdf', v_hash, 'application/pdf', 100, 'uploaded', 121000.00)
    RETURNING total_cents INTO v_cents;
  IF v_cents IS DISTINCT FROM 12100000 THEN RAISE EXCEPTION 'FAIL total_cents 121000.00 -> %', v_cents; END IF;
  UPDATE documents SET total_amount = 10.005 WHERE id = v_probe RETURNING total_cents INTO v_cents;
  IF v_cents IS NOT NULL THEN RAISE EXCEPTION 'FAIL total_cents 10.005 -> % (se esperaba NULL)', v_cents; END IF;
  UPDATE documents SET total_amount = 10.1000 WHERE id = v_probe RETURNING total_cents INTO v_cents;
  IF v_cents IS DISTINCT FROM 1010 THEN RAISE EXCEPTION 'FAIL total_cents 10.1000 -> %', v_cents; END IF;
  UPDATE documents SET total_amount = -50.25 WHERE id = v_probe RETURNING total_cents INTO v_cents;
  IF v_cents IS DISTINCT FROM -5025 THEN RAISE EXCEPTION 'FAIL total_cents -50.25 -> %', v_cents; END IF;
  UPDATE documents SET total_amount = NULL WHERE id = v_probe RETURNING total_cents INTO v_cents;
  IF v_cents IS NOT NULL THEN RAISE EXCEPTION 'FAIL total_cents NULL -> %', v_cents; END IF;
  UPDATE documents SET total_amount = 999999999999999.99 WHERE id = v_probe RETURNING total_cents INTO v_cents;
  IF v_cents IS DISTINCT FROM 99999999999999999 THEN RAISE EXCEPTION 'FAIL total_cents máximo -> %', v_cents; END IF;
  DELETE FROM documents WHERE id = v_probe;
  RAISE NOTICE 'PASS 3: total_cents exacto (2 decimales convierten, 3+ decimales y NULL dan NULL, negativos y máximo correctos)';
END $$;

-- 4. NUMERIC(19,4): valor máximo permitido y desborde -----------------------------
DO $$
DECLARE
  v_probe uuid := '90000000-0000-4000-8000-000000000002';
  v_org uuid := '10000000-0000-4000-8000-000000000001';
  v_hash char(64) := 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2';
BEGIN
  INSERT INTO documents (id, organization_id, file_name, file_hash, mime_type, size_bytes, status, total_amount)
    VALUES (v_probe, v_org, 'sonda.pdf', v_hash, 'application/pdf', 100, 'uploaded', 999999999999999.9999);
  DELETE FROM documents WHERE id = v_probe;
  RAISE NOTICE 'PASS 4a: NUMERIC(19,4) acepta su máximo (999999999999999.9999)';
END $$;

DO $$
DECLARE
  v_probe uuid := '90000000-0000-4000-8000-000000000003';
  v_org uuid := '10000000-0000-4000-8000-000000000001';
  v_hash char(64) := 'f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3';
BEGIN
  BEGIN
    INSERT INTO documents (id, organization_id, file_name, file_hash, mime_type, size_bytes, status, total_amount)
      VALUES (v_probe, v_org, 'sonda.pdf', v_hash, 'application/pdf', 100, 'uploaded', 10000000000000000.00);
    RAISE EXCEPTION 'FAIL: el desborde NUMERIC no fue rechazado';
  EXCEPTION WHEN SQLSTATE '22003' THEN
    RAISE NOTICE 'PASS 4b: desborde NUMERIC(19,4) rechazado (SQLSTATE 22003 numeric_value_out_of_range)';
  END;
END $$;

-- 5. Rechazos de restricciones ---------------------------------------------------
DO $$ BEGIN BEGIN
  INSERT INTO document_fields (document_id, field_key, source) VALUES ('90000000-0000-4000-8000-00000000ffff', 'supplier_name', 'sonda');
  RAISE EXCEPTION 'FAIL: FK inválida no rechazada';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS 5a: FK inválida rechazada'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO documents (id, organization_id, file_name, file_hash, mime_type, size_bytes, status)
    VALUES ('90000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 's.pdf', 'f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4', 'application/pdf', 1, 'inexistente');
  RAISE EXCEPTION 'FAIL: estado inválido no rechazado';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 5b: CHECK de estado rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO organization_members (organization_id, user_id, role)
    VALUES ('10000000-0000-4000-8000-000000000001', 'usuario-sonda', 'viewer');
  RAISE EXCEPTION 'FAIL: rol viewer no rechazado';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 5c: CHECK de rol (sin viewer) rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO document_validations (document_id, rule_code, severity, message)
    VALUES ('20000000-0000-4000-8000-000000000001', 'SONDA', 'fatal', 'sonda');
  RAISE EXCEPTION 'FAIL: severidad inválida no rechazada';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 5d: CHECK de severidad rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO processing_jobs (document_id, job_type, attempts, max_attempts)
    VALUES ('20000000-0000-4000-8000-000000000001', 'extraction', 4, 3);
  RAISE EXCEPTION 'FAIL: attempts > max_attempts no rechazado';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 5e: CHECK de intentos rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO document_fields (document_id, field_key, source, page_number)
    VALUES ('20000000-0000-4000-8000-000000000001', 'sonda_page', 'sonda', 0);
  RAISE EXCEPTION 'FAIL: page_number 0 no rechazado';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 5f: CHECK de page_number rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO document_fields (document_id, field_key, source, confidence)
    VALUES ('20000000-0000-4000-8000-000000000001', 'sonda_conf', 'sonda', 1.5);
  RAISE EXCEPTION 'FAIL: confidence 1.5 no rechazado';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 5g: CHECK de confidence rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO organization_members (organization_id, user_id, role)
    VALUES ('10000000-0000-4000-8000-000000000001', 'usuario-ficticio-01', 'org_admin');
  RAISE EXCEPTION 'FAIL: miembro duplicado (org+user) no rechazado';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 5h: UNIQUE org+user rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO duplicate_candidates (document_id, candidate_document_id, kind, reason_code)
    VALUES ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'business_exact', 'BUSINESS_EXACT');
  RAISE EXCEPTION 'FAIL: par de candidatos duplicado no rechazado';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 5i: UNIQUE par de candidatos rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO document_decisions (document_id, decided_by, decision)
    VALUES ('20000000-0000-4000-8000-000000000005', 'sonda', 'approved');
  RAISE EXCEPTION 'FAIL: segunda decisión para el mismo documento no rechazada';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 5j: UNIQUE decisión por documento rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO document_fields (document_id, field_key, source)
    VALUES ('20000000-0000-4000-8000-000000000001', 'supplier_name', 'sonda');
  RAISE EXCEPTION 'FAIL: campo duplicado (doc+campo) no rechazado';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 5k: UNIQUE campo por documento rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO extraction_lines (document_id, line_number)
    VALUES ('20000000-0000-4000-8000-000000000005', 1);
  RAISE EXCEPTION 'FAIL: línea duplicada (doc+número) no rechazada';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 5l: UNIQUE línea por documento rechazado'; END; END $$;

DO $$ BEGIN BEGIN
  INSERT INTO export_items (export_id, document_id)
    VALUES ('a0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005');
  RAISE EXCEPTION 'FAIL: ítem de exportación duplicado no rechazado';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 5m: UNIQUE ítem por exportación rechazado'; END; END $$;

-- 6. Unicidad parcial de permisos --------------------------------------------------
DO $$ BEGIN BEGIN
  INSERT INTO member_permissions (organization_id, user_id, permission_key, granted_by)
    VALUES ('10000000-0000-4000-8000-000000000001', 'usuario-ficticio-02', 'approve_documents', 'sonda');
  RAISE EXCEPTION 'FAIL: concesión activa duplicada no rechazada';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 6a: UNIQUE parcial (concesión activa duplicada) rechazado'; END; END $$;

DO $$
DECLARE v_n int;
BEGIN
  INSERT INTO member_permissions (organization_id, user_id, permission_key, granted_by, revoked_by, revoked_at)
    VALUES ('10000000-0000-4000-8000-000000000001', 'usuario-sonda-01', 'approve_documents', 'sonda', 'sonda', now());
  INSERT INTO member_permissions (organization_id, user_id, permission_key, granted_by)
    VALUES ('10000000-0000-4000-8000-000000000001', 'usuario-sonda-01', 'approve_documents', 'sonda');
  SELECT count(*) INTO v_n FROM member_permissions WHERE user_id = 'usuario-sonda-01';
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL: revocada+nueva no suman 2 filas'; END IF;
  DELETE FROM member_permissions WHERE user_id = 'usuario-sonda-01';
  RAISE NOTICE 'PASS 6b: revocada + nueva activa conviven (la unicidad parcial solo bloquea dos activas)';
END $$;

-- 6c. Idempotencia: NULL múltiples permitidos, duplicado rechazado ------------------
DO $$
DECLARE
  v_key text := '10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1:stub';
  v_n int;
BEGIN
  INSERT INTO processing_jobs (document_id, job_type, idempotency_key) VALUES ('20000000-0000-4000-8000-000000000001', 'extraction', NULL);
  INSERT INTO processing_jobs (document_id, job_type, idempotency_key) VALUES ('20000000-0000-4000-8000-000000000001', 'extraction', NULL);
  SELECT count(*) INTO v_n FROM processing_jobs WHERE idempotency_key IS NULL AND document_id = '20000000-0000-4000-8000-000000000001';
  IF v_n < 2 THEN RAISE EXCEPTION 'FAIL: dos claves NULL no convivieron'; END IF;
  DELETE FROM processing_jobs WHERE idempotency_key IS NULL AND document_id = '20000000-0000-4000-8000-000000000001';
  BEGIN
    INSERT INTO processing_jobs (document_id, job_type, idempotency_key) VALUES ('20000000-0000-4000-8000-000000000001', 'extraction', v_key);
    RAISE EXCEPTION 'FAIL: clave de idempotencia duplicada no rechazada';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS 6c: idempotencia (NULL múltiples OK, duplicada rechazada)';
  END;
END $$;

-- 7. Aislamiento en lectura (con datos reales) ---------------------------------------
DO $$
DECLARE v_a int; v_b int; v_cross_cand int; v_cross_exp int;
BEGIN
  SELECT count(*) INTO v_a FROM documents WHERE organization_id = '10000000-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_b FROM documents WHERE organization_id = '10000000-0000-4000-8000-000000000002';
  IF v_a <> 12 OR v_b <> 2 THEN RAISE EXCEPTION 'FAIL aislamiento lectura: orgA=% orgB=%', v_a, v_b; END IF;
  SELECT count(*) INTO v_cross_cand FROM duplicate_candidates c
    JOIN documents d1 ON d1.id = c.document_id JOIN documents d2 ON d2.id = c.candidate_document_id
    WHERE d1.organization_id <> d2.organization_id;
  SELECT count(*) INTO v_cross_exp FROM export_items i
    JOIN exports e ON e.id = i.export_id JOIN documents d ON d.id = i.document_id
    WHERE e.organization_id <> d.organization_id;
  IF v_cross_cand <> 0 OR v_cross_exp <> 0 THEN
    RAISE EXCEPTION 'FAIL aislamiento: pares cross-org=% ítems cross-org=%', v_cross_cand, v_cross_exp;
  END IF;
  RAISE NOTICE 'PASS 7: aislamiento en lectura (orgA=12, orgB=2, 0 pares y 0 ítems cross-org en seeds)';
END $$;

-- 8. Limitaciones confirmadas (NO son PASS de los controles) -------------------------
-- Cada bloque inserta y borra en la misma transacción: no deja residuos.
-- Su NOTICE documenta que la base PERMITE el caso y que el control sigue
-- pendiente de lógica de aplicación.
DO $$
DECLARE v_doc_b uuid;
BEGIN
  SELECT id INTO v_doc_b FROM documents WHERE organization_id = '10000000-0000-4000-8000-000000000002' LIMIT 1;
  INSERT INTO duplicate_candidates (document_id, candidate_document_id, kind, reason_code)
    VALUES ('20000000-0000-4000-8000-000000000001', v_doc_b, 'business_probable', 'P1');
  DELETE FROM duplicate_candidates WHERE document_id = '20000000-0000-4000-8000-000000000001' AND candidate_document_id = v_doc_b;
  RAISE NOTICE 'LIMITACIÓN 8a (A-01): la base PERMITE un candidato cross-org; el control requiere lógica de aplicación (pendiente)';
END $$;

DO $$
DECLARE v_doc_b uuid;
BEGIN
  SELECT id INTO v_doc_b FROM documents WHERE organization_id = '10000000-0000-4000-8000-000000000002' LIMIT 1;
  INSERT INTO export_items (export_id, document_id)
    VALUES ('a0000000-0000-4000-8000-000000000001', v_doc_b);
  DELETE FROM export_items WHERE export_id = 'a0000000-0000-4000-8000-000000000001' AND document_id = v_doc_b;
  RAISE NOTICE 'LIMITACIÓN 8b (A-02): la base PERMITE un ítem de exportación cross-org y no exige approved; el control requiere lógica de aplicación (pendiente)';
END $$;

DO $$
BEGIN
  UPDATE documents SET status = 'uploaded' WHERE id = '20000000-0000-4000-8000-000000000005';
  UPDATE documents SET status = 'approved' WHERE id = '20000000-0000-4000-8000-000000000005';
  RAISE NOTICE 'LIMITACIÓN 8c (M-01): la base PERMITE transiciones arbitrarias (approved->uploaded->approved); la máquina de estados requiere lógica de aplicación (pendiente)';
END $$;

DO $$
BEGIN
  INSERT INTO member_permissions (organization_id, user_id, permission_key, granted_by)
    VALUES ('10000000-0000-4000-8000-000000000001', 'usuario-no-miembro', 'approve_documents', 'sonda');
  DELETE FROM member_permissions WHERE user_id = 'usuario-no-miembro';
  RAISE NOTICE 'LIMITACIÓN 8d (M-02): la base PERMITE conceder a un no miembro; el control requiere lógica de aplicación (pendiente)';
END $$;

DO $$
BEGIN
  INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id)
    VALUES ('10000000-0000-4000-8000-000000000002', 'sonda', 'sonda.accion', 'documents', '20000000-0000-4000-8000-000000000001');
  DELETE FROM audit_events WHERE actor_id = 'sonda' AND action = 'sonda.accion';
  RAISE NOTICE 'LIMITACIÓN 8e (M-03): la base PERMITE un evento con org distinta de la entidad; el control requiere lógica de aplicación (pendiente)';
END $$;

\echo 'verify-h2.sql completado: revisar los NOTICE PASS y LIMITACIÓN anteriores.'

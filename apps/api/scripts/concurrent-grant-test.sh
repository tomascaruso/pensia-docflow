#!/bin/sh
# DocFlow H2 — Prueba de concurrencia del índice único parcial de permisos.
#
# Escenario: dos sesiones insertan a la vez la misma concesión activa
# (org A, usuario-sonda-conc, approve_documents). Se espera que una
# inserción tenga éxito y la otra falle con unique_violation.
#
# Seguridad del destino (dos capas, ambas antes de cualquier escritura):
#   1. Puerta de URL: `src/db/check-destination.ts` (misma guarda que
#      seed/migrate) rechaza destinos no autorizados ANTES de invocar
#      `psql`. Si la puerta no está disponible (tsx no encontrado),
#      el script aborta: nunca se avanza sin validación (fail-closed).
#   2. Validación post-conexión: una consulta de solo lectura confirma
#      current_database() = 'docflow_dev' Y servidor local según el
#      propio servidor (inet_server_addr() nulo para socket local, o
#      127.0.0.1 / ::1). Si no es 'OK', se aborta antes de las sesiones.
#
# Limpieza: solo se borran las filas exactas creadas por ESTA ejecución,
# identificadas por su id (RETURNING id de cada sesión). Si no se capturó
# ningún id, no se borra nada. Nunca se borra por user_id ni por ninguna
# condición más amplia. No toca seeds.
#
# Requiere DATABASE_URL apuntando a docflow_dev local y dependencias
# instaladas (`npm ci` previo, para tsx). Uso:
#   DATABASE_URL=postgresql://usuario@127.0.0.1:5432/docflow_dev sh scripts/concurrent-grant-test.sh
set -u
: "${DATABASE_URL:?DATABASE_URL no definida}"

# --- Capa 1: puerta de URL (antes de cualquier psql) -------------------------
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
API_DIR=$(dirname "$SCRIPT_DIR")
ROOT_DIR=$(dirname "$(dirname "$API_DIR")")
TSX=""
if [ -x "$ROOT_DIR/node_modules/.bin/tsx" ]; then TSX="$ROOT_DIR/node_modules/.bin/tsx";
elif [ -x "$API_DIR/node_modules/.bin/tsx" ]; then TSX="$API_DIR/node_modules/.bin/tsx";
elif command -v tsx >/dev/null 2>&1; then TSX="tsx"; fi
if [ -z "$TSX" ]; then
  echo "concurrent-grant-test: guarda no disponible (tsx no encontrado); abortado sin ejecutar SQL." >&2
  exit 2
fi
if ! DATABASE_URL="$DATABASE_URL" "$TSX" "$API_DIR/src/db/check-destination.ts" >/dev/null 2>&1; then
  echo "concurrent-grant-test: destino no autorizado; abortado sin ejecutar SQL." >&2
  exit 2
fi

# --- Capa 2: validación post-conexión (solo lectura, antes de escribir) ------
PREFLIGHT=$(psql "$DATABASE_URL" -tAc "SELECT CASE WHEN current_database() <> 'docflow_dev' THEN 'DB_MISMATCH' WHEN inet_server_addr() IS NOT NULL AND inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN 'NOT_LOCAL' ELSE 'OK' END;" 2>/dev/null)
if [ "$PREFLIGHT" != "OK" ]; then
  echo "concurrent-grant-test: destino real no autorizado (${PREFLIGHT:-sin respuesta}); abortado sin ejecutar SQL." >&2
  exit 2
fi

A_OUT=$(mktemp)
B_OUT=$(mktemp)
trap 'rm -f "$A_OUT" "$B_OUT"' EXIT INT TERM

# Sesión A: inserta (con RETURNING id) y mantiene la transacción abierta 4 s.
psql "$DATABASE_URL" -tA -v ON_ERROR_STOP=1 \
  "BEGIN; INSERT INTO member_permissions (organization_id, user_id, permission_key, granted_by) VALUES ('10000000-0000-4000-8000-000000000001','usuario-sonda-conc','approve_documents','sonda') RETURNING id; SELECT pg_sleep(4); COMMIT;" \
  >"$A_OUT" 2>&1 &
sleep 1
# Sesión B: intenta la misma inserción mientras A no confirmó (debe bloquear
# y luego fallar con unique_violation cuando A confirma).
psql "$DATABASE_URL" -tA -v ON_ERROR_STOP=1 \
  "INSERT INTO member_permissions (organization_id, user_id, permission_key, granted_by) VALUES ('10000000-0000-4000-8000-000000000001','usuario-sonda-conc','approve_documents','sonda') RETURNING id;" \
  >"$B_OUT" 2>&1
B_STATUS=$?
wait
A_STATUS=$?

echo "--- sesión A (salida $A_STATUS) ---"
cat "$A_OUT"
echo "--- sesión B (salida $B_STATUS) ---"
cat "$B_OUT"

# Limpieza por id exacto: solo líneas que son exactamente un UUID (la
# salida RETURNING). El patrón impide interpolar cualquier otro texto.
# Si no se capturó ningún id, no se borra nada.
extract_uuid() {
  grep -E '^[[:space:]]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[[:space:]]*$' "$1" | head -n 1 | tr -d '[:space:]'
}
A_ID=$(extract_uuid "$A_OUT")
B_ID=$(extract_uuid "$B_OUT")
if [ -n "$A_ID" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM member_permissions WHERE id = '$A_ID';" >/dev/null 2>&1
fi
if [ -n "$B_ID" ] && [ "$B_ID" != "$A_ID" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM member_permissions WHERE id = '$B_ID';" >/dev/null 2>&1
fi
if [ -z "$A_ID" ] && [ -z "$B_ID" ]; then
  echo "concurrent-grant-test: no se capturó ningún id de sonda; no se borró nada." >&2
fi

if grep -qiE 'duplicate key|unique_violation|already exists' "$B_OUT"; then
  echo "VEREDICTO: PASS — la segunda inserción concurrente fue rechazada por el índice único parcial."
  exit 0
else
  echo "VEREDICTO: FAIL — la sesión B no fue rechazada como se esperaba (revisar salidas)."
  exit 1
fi

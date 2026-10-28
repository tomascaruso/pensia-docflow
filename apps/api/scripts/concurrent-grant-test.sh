#!/bin/sh
# DocFlow H2 — Prueba de concurrencia del índice único parcial de permisos.
#
# Escenario: dos sesiones insertan a la vez la misma concesión activa
# (org A, usuario-sonda-conc, approve_documents). Se espera que una
# inserción tenga éxito y la otra falle con unique_violation.
#
# Requiere DATABASE_URL apuntando a docflow_dev local. No deja residuos:
# la fila insertada por la sesión A se elimina al final. No toca seeds.
#
# Uso:
#   DATABASE_URL=postgresql://usuario@127.0.0.1:5432/docflow_dev sh scripts/concurrent-grant-test.sh
set -u
: "${DATABASE_URL:?DATABASE_URL no definida}"

A_OUT=$(mktemp)
B_OUT=$(mktemp)
trap 'rm -f "$A_OUT" "$B_OUT"' EXIT INT TERM

# Sesión A: inserta y mantiene la transacción abierta 4 s antes de confirmar.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "BEGIN; INSERT INTO member_permissions (organization_id, user_id, permission_key, granted_by) VALUES ('10000000-0000-4000-8000-000000000001','usuario-sonda-conc','approve_documents','sonda'); SELECT pg_sleep(4); COMMIT;" \
  >"$A_OUT" 2>&1 &
sleep 1
# Sesión B: intenta la misma inserción mientras A no confirmó (debe bloquear
# y luego fallar con unique_violation cuando A confirma).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "INSERT INTO member_permissions (organization_id, user_id, permission_key, granted_by) VALUES ('10000000-0000-4000-8000-000000000001','usuario-sonda-conc','approve_documents','sonda');" \
  >"$B_OUT" 2>&1
B_STATUS=$?
wait
A_STATUS=$?

echo "--- sesión A (salida $A_STATUS) ---"
cat "$A_OUT"
echo "--- sesión B (salida $B_STATUS) ---"
cat "$B_OUT"

# Limpieza: eliminar la fila de sonda, la haya insertado quien la haya insertado.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM member_permissions WHERE user_id = 'usuario-sonda-conc';" >/dev/null 2>&1

if grep -qiE 'duplicate key|unique_violation|already exists' "$B_OUT"; then
  echo "VEREDICTO: PASS — la segunda inserción concurrente fue rechazada por el índice único parcial."
  exit 0
else
  echo "VEREDICTO: FAIL — la sesión B no fue rechazada como se esperaba (revisar salidas)."
  exit 1
fi

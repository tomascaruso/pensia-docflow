#!/bin/sh
# DocFlow H2 — Prueba de la puerta de destino SIN PostgreSQL real.
#
# Verifica con un `psql` falso (stub) que, ante un destino no autorizado,
# NI `db:verify` NI `concurrent-grant-test.sh` invocan `psql` en absoluto,
# y que ante un destino autorizado la cadena sí alcanza a `psql`.
#
# El stub solo registra cada invocación en un archivo marcador y sale 0
# (o imprime 'OK' ante la consulta de pre-vuelo). Nunca toca una base real
# ni ejecuta SQL. No requiere PostgreSQL instalado: solo `npm ci` previo
# (para tsx) y `sh`.
#
# Uso (desde apps/api):
#   sh scripts/test-destination-gate.sh
# Salida 0 = los 4 casos pasaron. Cualquier fallo sale 1.
set -u

API_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$API_DIR" || exit 1

STUB_DIR=$(mktemp -d)
MARKER="$STUB_DIR/marker"
trap 'rm -rf "$STUB_DIR"' EXIT INT TERM

# Stub psql: registra cada invocación (sin registrar argumentos: podrían
# contener una URL con contraseña) y responde 'OK' solo a la pre-vuelo.
cat > "$STUB_DIR/psql" <<'STUB'
#!/bin/sh
echo "invocado" >> "$PSQL_MARKER"
for arg in "$@"; do
  case "$arg" in
    *current_database*) echo "OK"; break ;;
  esac
done
exit 0
STUB
chmod +x "$STUB_DIR/psql"

count_invocations() {
  if [ -f "$MARKER" ]; then wc -l < "$MARKER" | tr -d ' '; else echo 0; fi
}

FAIL=0
check() {
  # $1 = descripción, $2 = esperado, $3 = obtenido
  if [ "$2" = "$3" ]; then
    echo "PASS: $1 (esperado=$2, obtenido=$3)"
  else
    echo "FAIL: $1 (esperado=$2, obtenido=$3)"
    FAIL=1
  fi
}

# Caso 1: db:verify con destino remoto -> sin invocación de psql, salida != 0.
rm -f "$MARKER"
PATH="$STUB_DIR:$PATH" PSQL_MARKER="$MARKER" DATABASE_URL="postgresql://usuario@db.remoto.example:5432/docflow_dev" npm run db:verify >/dev/null 2>&1
STATUS=$?
check "db:verify remoto no invoca psql" "0" "$(count_invocations)"
[ "$STATUS" -ne 0 ]; check "db:verify remoto sale distinto de 0" "distinto-de-0" "$([ "$STATUS" -ne 0 ] && echo "distinto-de-0" || echo "0")"

# Caso 2: db:verify con destino autorizado -> exactamente 1 invocación.
rm -f "$MARKER"
PATH="$STUB_DIR:$PATH" PSQL_MARKER="$MARKER" DATABASE_URL="postgresql://usuario@127.0.0.1:5432/docflow_dev" npm run db:verify >/dev/null 2>&1
STATUS=$?
check "db:verify autorizado invoca psql 1 vez" "1" "$(count_invocations)"
check "db:verify autorizado sale 0 (stub)" "0" "$STATUS"

# Caso 3: concurrencia con destino remoto -> sin invocación de psql.
rm -f "$MARKER"
PATH="$STUB_DIR:$PATH" PSQL_MARKER="$MARKER" DATABASE_URL="postgresql://usuario@192.168.1.10:5432/docflow_dev" sh scripts/concurrent-grant-test.sh >/dev/null 2>&1
STATUS=$?
check "concurrencia remota no invoca psql" "0" "$(count_invocations)"
[ "$STATUS" -ne 0 ]; check "concurrencia remota sale distinto de 0" "distinto-de-0" "$([ "$STATUS" -ne 0 ] && echo "distinto-de-0" || echo "0")"

# Caso 4: concurrencia con destino autorizado -> alcanza pre-vuelo + sesiones
# (3 invocaciones: pre-vuelo, sesión A, sesión B). La limpieza no se invoca
# porque el stub no devuelve ningún id (no hay nada que borrar). El
# veredicto es FAIL esperado en modo stub (sin PostgreSQL real no hay
# violación de unicidad que detectar); lo que se verifica aquí es el
# orden: puerta -> pre-vuelo -> sesiones, sin borrado sin id.
rm -f "$MARKER"
PATH="$STUB_DIR:$PATH" PSQL_MARKER="$MARKER" DATABASE_URL="postgresql://usuario@127.0.0.1:5432/docflow_dev" sh scripts/concurrent-grant-test.sh >/dev/null 2>&1
STATUS=$?
check "concurrencia autorizada invoca psql 3 veces (pre-vuelo + A + B, sin limpieza)" "3" "$(count_invocations)"
check "concurrencia en modo stub sale 1 (veredicto FAIL esperado sin PG real)" "1" "$STATUS"

exit "$FAIL"

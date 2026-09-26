#!/usr/bin/env bash
# Despliega ThreeCraft.js (el estático de dist/) a su propio subdominio en la
# VPS de luisaldrichguz.net. Uso: ./scripts/deploy.sh
#
# Es un subdominio, no una ruta dentro del portafolio: el juego usa rutas
# absolutas (/textures/*, /fonts/*, /sounds/*) por todos lados, y bajo una
# ruta tipo /threecraft/ el navegador las buscaría en la raíz del dominio y
# todo saldría roto. Con subdominio, base "/" y no hay que tocar nada.
set -euo pipefail

HOST="${VPS_HOST:-vps}"
DOMAIN="threecraft.luisaldrichguz.net"
REMOTE="/srv/$DOMAIN"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"

ssh -o BatchMode=yes -o ConnectTimeout=5 "$HOST" true 2>/dev/null || {
  echo "No se pudo conectar a '$HOST'. Revisa el bloque Host en ~/.ssh/config." >&2
  exit 1
}

# ⚠️ El registro DNS (A $DOMAIN → la IP del server) lo crea Luis a mano en su
# proveedor — no hay wildcard. Sin eso, Caddy nunca consigue el certificado.
resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | head -1 | awk '{print $1}' || true)
# el resolver local a veces va atrás; si falla, se pregunta a un DNS público
[ -z "$resolved" ] && resolved=$(dig +short "$DOMAIN" @1.1.1.1 2>/dev/null | head -1)
if [ -z "$resolved" ]; then
  echo "❌ $DOMAIN no resuelve todavía. Crea el registro DNS (A → IP del server) y espera a que propague." >&2
  exit 1
fi
echo "==> $DOMAIN resuelve a $resolved"

echo "==> Compilando (npm run build)"
( cd "$ROOT" && npm run build )

[ -d "$DIST" ] || {
  echo "El build no dejó $DIST" >&2
  exit 1
}

echo "==> Subiendo dist/ a $HOST:$REMOTE"
ssh "$HOST" "sudo mkdir -p $REMOTE && sudo chown \$(whoami) $REMOTE"
rsync -az --delete "$DIST/" "$HOST:$REMOTE/"

echo "==> Subiendo el bloque de Caddy"
rsync -az "$ROOT/infra/threecraft.caddy" "$HOST:/tmp/threecraft.caddy"
ssh "$HOST" "sudo mkdir -p /etc/caddy/sites.d && sudo mv /tmp/threecraft.caddy /etc/caddy/sites.d/$DOMAIN.caddy"

echo "==> Validando y recargando Caddy"
ssh "$HOST" "sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy"

echo "==> Verificando que responda por HTTPS"
sleep 2
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/" || true)
if [ "$code" != "200" ]; then
  echo "⚠️  https://$DOMAIN respondió '$code' (esperaba 200)." >&2
  echo "    Puede ser sólo que Let's Encrypt está pidiendo el certificado — reintenta en 30s." >&2
  echo "    Si sigue: ssh vps 'sudo journalctl -u caddy -n 40 --no-pager'" >&2
  exit 1
fi

echo "==> Listo · https://$DOMAIN/"

#!/usr/bin/env bash
# Deploy or update Hello DANAVA on cPanel (CloudLinux "Setup Node.js App").
#
# First install (creates the app and the first admin account):
#   ADMIN_EMAIL='admin@danava.vn' ADMIN_PASSWORD='<12-128 chars>' bash deploy.sh
# Update to the latest code on GitHub (keeps data and settings):
#   bash ~/hellodanava/deploy.sh
#
# Never commit passwords: this repository is public.
set -u

APP="${APP:-hellodanava}"
DOMAIN="${DOMAIN:-hello.danava.vn}"
DATA="${DATA_DIR:-$HOME/hellodanava-data}"
# Mirror: https://github.com/danava-org/DANAVA_Hello.git (kept identical). Override with REPO=... for a fresh clone.
REPO="${REPO:-https://github.com/HungNguyen3205/hellodanava.git}"

step() { printf '\n== %s ==\n' "$*"; }
fail() { printf 'LOI: %s\n' "$*"; exit 1; }

step "1/6 Phien ban Node"
NODE_VER=$(ls -d /opt/alt/alt-nodejs* 2>/dev/null | sed 's/.*alt-nodejs//' | sort -n | tail -1)
[ -n "$NODE_VER" ] || fail "server khong co Node.js Selector."
"/opt/alt/alt-nodejs$NODE_VER/root/usr/bin/node" -e "require('node:sqlite');console.log('OK Node',process.version)" \
  || fail "Node $NODE_VER qua cu (can >= 22.13, tot nhat 24)."

step "2/6 Code tu GitHub"
cd "$HOME" || fail "khong vao duoc thu muc home."
if [ -d "$APP/.git" ]; then
  git -C "$APP" pull --ff-only || fail "git pull that bai (co sua file truc tiep tren server?)."
else
  git clone "$REPO" "$APP" || fail "git clone that bai."
fi
git -C "$APP" log --oneline -1

step "3/6 Thu muc du lieu"
mkdir -p "$DATA" && chmod 700 "$DATA"
echo "$DATA"

step "4/6 Ung dung Node"
if cloudlinux-selector get --json --interpreter=nodejs 2>/dev/null | grep -q "\"$APP\""; then
  echo "App da ton tai: giu nguyen cau hinh va du lieu, chi khoi dong lai."
else
  [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ] \
    || fail "cai lan dau can ADMIN_EMAIL va ADMIN_PASSWORD, vd: ADMIN_EMAIL='admin@danava.vn' ADMIN_PASSWORD='...' bash deploy.sh"
  [ "${#ADMIN_PASSWORD}" -ge 12 ] || fail "ADMIN_PASSWORD can it nhat 12 ky tu."
  cloudlinux-selector create --json --interpreter=nodejs --version="$NODE_VER" \
    --app-root="$APP" --domain="$DOMAIN" --app-uri=/ --app-mode=production --startup-file=app.cjs \
    || fail "khong tao duoc app."
  cloudlinux-selector set --json --interpreter=nodejs --app-root="$APP" \
    --env-vars="{\"DATA_DIR\":\"$DATA\",\"ADMIN_EMAIL\":\"$ADMIN_EMAIL\",\"ADMIN_PASSWORD\":\"$ADMIN_PASSWORD\",\"SECURE_COOKIES\":\"1\"}" \
    || fail "khong dat duoc bien moi truong."
fi
cloudlinux-selector restart --json --interpreter=nodejs --app-root="$APP" || fail "khong khoi dong lai duoc app."

step "5/6 Chung chi SSL"
has_cert() {
  echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null \
    | openssl x509 -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$DOMAIN\(,\|$\)"
}
if has_cert; then
  echo "OK: da co SSL cho $DOMAIN"
else
  echo "Chua co SSL -> chay AutoSSL, cho 2 phut..."
  uapi SSL start_autossl_check >/dev/null 2>&1
  sleep 120
  has_cert && echo "OK: da co SSL cho $DOMAIN" \
    || echo "CHUA co SSL: kiem tra DNS cua $DOMAIN tro ve server nay, roi vao 'SSL/TLS Status' bam Run AutoSSL."
fi

step "6/6 Kiem tra qua ten mien that"
# The first request also wakes the app up (Passenger starts it on demand).
code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' "https://$DOMAIN/")
api=$(curl -s -m 30 "https://$DOMAIN/api/catalog" | head -c 9)
echo "Trang chu: $code"
if [ "$code" = 200 ] && [ "$api" = '{"plans":' ]; then
  echo "API bang gia: OK"
else
  echo "API bang gia: CHUA DUNG (nhan duoc: ${api:-<trong>})"
  echo "Xem log: tail -n 40 $HOME/$APP/stderr.log"
fi
ls -la "$DATA"
printf '\nXong: https://%s  |  quan tri: https://%s/admin\n' "$DOMAIN" "$DOMAIN"

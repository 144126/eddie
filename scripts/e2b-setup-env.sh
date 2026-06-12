#!/usr/bin/env bash
# scripts/e2b-setup-env.sh — wire eddie to a self-hosted e2b cluster.
#
# Runs `make seed-db` in your e2b-dev/infra clone to (re)generate the
# team API key + access token, optionally builds the base template,
# then writes them into eddie's .env.
#
# After this, `pnpm dev` in eddie is wired up to your self-host cluster.
set -euo pipefail

usage() {
	cat <<'EOF'
usage: scripts/e2b-setup-env.sh [options]

  -i, --infra-dir DIR    path to your e2b-dev/infra clone
                          (default: ../infra or $E2B_INFRA_DIR)
  -d, --domain DOMAIN    your e2b orchestrator domain, e.g. e2b.example.com
                          (or $E2B_DOMAIN)
  -e, --email EMAIL      admin email for the seeded team
                          (default: admin@<domain>)
      --with-template    also run `make build-base-template` after seed-db
      --no-env-write     print the keys but don't write .env
  -h, --help             show this help

NOTE: seed-db deletes all envs, snapshots, volumes, addons, teams, and
users that match the seed email, then re-creates the team + a fresh key.
Any running sandboxes owned by that team will become unreachable.
EOF
}

INFRA_DIR="${E2B_INFRA_DIR:-../infra}"
DOMAIN="${E2B_DOMAIN:-}"
EMAIL=""
WITH_TEMPLATE=0
WRITE_ENV=1

while [[ $# -gt 0 ]]; do
	case "$1" in
	-i | --infra-dir) INFRA_DIR="$2"; shift 2 ;;
	-d | --domain) DOMAIN="$2"; shift 2 ;;
	-e | --email) EMAIL="$2"; shift 2 ;;
	--with-template) WITH_TEMPLATE=1; shift ;;
	--no-env-write) WRITE_ENV=0; shift ;;
	-h | --help) usage; exit 0 ;;
	*) echo "unknown arg: $1" >&2; usage; exit 2 ;;
	esac
done

if [[ -z "$DOMAIN" ]]; then
	echo "error: --domain is required (e.g. e2b.example.com)" >&2
	exit 2
fi
if [[ -z "$EMAIL" ]]; then EMAIL="admin@${DOMAIN}"; fi
if [[ ! -d "$INFRA_DIR" ]]; then
	echo "error: infra dir not found: $INFRA_DIR" >&2
	echo "  clone e2b-dev/infra next to eddie, or pass --infra-dir PATH" >&2
	exit 2
fi

cd "$INFRA_DIR"

echo "[1/3] seeding database in $INFRA_DIR (email=$EMAIL) ..."
SEED_OUT=$(printf '%s\n' "$EMAIL" | make seed-db 2>&1)
echo "$SEED_OUT"

API_KEY=$(echo "$SEED_OUT" | awk -F'Team API Key:[[:space:]]*' '/Team API Key:/ {print $2}' | awk '{print $1}' | head -n1)
ACCESS_TOKEN=$(echo "$SEED_OUT" | awk -F'Access Token:[[:space:]]*' '/Access Token:/ {print $2}' | awk '{print $1}' | head -n1)

if [[ -z "$API_KEY" && -z "$ACCESS_TOKEN" ]]; then
	echo "error: could not parse API key or access token from seed-db output" >&2
	exit 1
fi

echo
echo "      Team API Key:    $API_KEY"
echo "      Access Token:    $ACCESS_TOKEN"
echo

if [[ $WITH_TEMPLATE -eq 1 ]]; then
	echo "[2/3] building base template ..."
	E2B_API_KEY="$API_KEY" E2B_DOMAIN="$DOMAIN" make build-base-template
else
	echo "[2/3] skipping base template build (pass --with-template to run it)"
fi

if [[ $WRITE_ENV -eq 1 ]]; then
	echo "[3/3] writing .env ..."
	EDDIE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
	ENV_FILE="$EDDIE_DIR/.env"
	touch "$ENV_FILE"

	upsert() {
		local key="$1" val="$2" file="$3"
		local tmp="${file}.tmp"
		awk -v k="$key" -v v="$val" '
			BEGIN { FS="="; OFS="=" }
			$1 == k { print k, v; found=1; next }
			{ print }
			END { if (!found) print k, v }
		' "$file" > "$tmp" && mv "$tmp" "$file"
	}

	upsert E2B_DOMAIN "$DOMAIN" "$ENV_FILE"
	[[ -n "$API_KEY" ]] && upsert E2B_API_KEY "$API_KEY" "$ENV_FILE"
	[[ -n "$ACCESS_TOKEN" ]] && upsert E2B_ACCESS_TOKEN "$ACCESS_TOKEN" "$ENV_FILE"

	echo "      wrote $ENV_FILE"
	echo
	echo "next: pnpm dev"
else
	echo "[3/3] skipping .env write (--no-env-write)"
fi

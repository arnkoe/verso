#!/usr/bin/env bash
# Prépare la signature macOS (certificat « Developer ID Application ») et
# enregistre les secrets GitHub lus par .github/workflows/release.yml.
#
# 1. scripts/setup-macos-signing.sh csr
#    Génère une clé privée et une demande de certificat (CSR) dans
#    ~/.verso-signing.
# 2. Sur developer.apple.com, créer un certificat « Developer ID Application »
#    avec ce CSR, puis télécharger le .cer.
# 3. scripts/setup-macos-signing.sh secrets <chemin du .cer>
#    Construit le .p12, vérifie qu'il s'importe comme en CI, demande l'Apple ID
#    et un mot de passe pour app, puis enregistre les six secrets avec gh.
#
# La clé privée reste dans ~/.verso-signing/key.pem : à sauvegarder avec le
# .cer. Avec les deux, relancer l'étape 3 suffit pour régénérer les secrets.
set -euo pipefail

DIR="$HOME/.verso-signing"
# LibreSSL de macOS : son .p12 s'importe avec `security import` (celui
# d'OpenSSL 3 exige -legacy).
OPENSSL=/usr/bin/openssl

cd "$(dirname "$0")/.."

cmd_csr() {
  mkdir -p "$DIR"
  chmod 700 "$DIR"
  if [ -e "$DIR/key.pem" ]; then
    echo "Une clé existe déjà ($DIR/key.pem) : rien n'est écrasé." >&2
    exit 1
  fi
  local email
  email=$(git config user.email || true)
  (umask 077 && "$OPENSSL" genrsa -out "$DIR/key.pem" 2048 2>/dev/null)
  "$OPENSSL" req -new -key "$DIR/key.pem" -out "$DIR/verso.csr" \
    -subj "/emailAddress=${email}/CN=Verso Developer ID"
  cat <<EOF
CSR créé : $DIR/verso.csr

Étape suivante :
  1. https://developer.apple.com/account/resources/certificates/add
  2. Choisir « Developer ID Application » (profil G2 Sub-CA), Continue.
  3. Téléverser $DIR/verso.csr, puis télécharger le .cer.
  4. scripts/setup-macos-signing.sh secrets ~/Downloads/developerID_application.cer
EOF
}

cmd_secrets() {
  local cer="${1:-}"
  if [ -z "$cer" ] || [ ! -f "$cer" ]; then
    echo "Usage : $0 secrets <chemin du .cer>" >&2
    exit 1
  fi
  [ -f "$DIR/key.pem" ] || { echo "Clé introuvable : lancer d'abord « $0 csr »." >&2; exit 1; }
  command -v gh >/dev/null || { echo "gh est requis (brew install gh)." >&2; exit 1; }

  (umask 077 && "$OPENSSL" x509 -inform DER -in "$cer" -out "$DIR/cert.pem")
  local subject team_id
  subject=$("$OPENSSL" x509 -in "$DIR/cert.pem" -noout -subject)
  case "$subject" in
    *"Developer ID Application"*) ;;
    *) echo "Ce n'est pas un certificat « Developer ID Application » : $subject" >&2; exit 1 ;;
  esac
  # Le Team ID figure entre parenthèses dans le nom du certificat.
  team_id=$(printf '%s\n' "$subject" | sed -n 's/.*Developer ID Application: .*(\([A-Z0-9]\{10\}\)).*/\1/p')
  if [ -z "$team_id" ]; then
    read -r -p "Team ID (developer.apple.com > Membership) : " team_id
  fi

  # Mots de passe jetables : ils ne servent qu'entre ce script et la CI.
  local p12="$DIR/verso.p12" kc="$DIR/verify.keychain" p12_pass kc_pass
  p12_pass=$("$OPENSSL" rand -base64 24)
  kc_pass=$("$OPENSSL" rand -base64 24)
  export P12_PASS="$p12_pass"
  (umask 077 && "$OPENSSL" pkcs12 -export -inkey "$DIR/key.pem" -in "$DIR/cert.pem" \
    -out "$p12" -passout env:P12_PASS)
  unset P12_PASS
  trap 'security delete-keychain "'"$kc"'" 2>/dev/null || true; rm -f "'"$p12"'"' EXIT

  # Même import que le workflow, dans un trousseau temporaire.
  security create-keychain -p "$kc_pass" "$kc"
  security unlock-keychain -p "$kc_pass" "$kc"
  security import "$p12" -k "$kc" -P "$p12_pass" -T /usr/bin/codesign >/dev/null
  if ! security find-identity -p codesigning "$kc" | grep -q "Developer ID Application"; then
    echo "Le .p12 ne s'importe pas comme identité de signature." >&2
    exit 1
  fi
  echo "Certificat vérifié (Team ID : $team_id)."

  local apple_id app_pass
  read -r -p "Apple ID du compte développeur : " apple_id
  echo "Mot de passe pour app : à créer sur https://account.apple.com"
  echo "(Connexion et sécurité > Mots de passe pour app), nom suggéré : Verso CI."
  read -r -s -p "Mot de passe pour app : " app_pass
  echo

  base64 -i "$p12" | tr -d '\n' | gh secret set APPLE_CERTIFICATE
  printf '%s' "$p12_pass" | gh secret set APPLE_CERTIFICATE_PASSWORD
  printf '%s' "$kc_pass" | gh secret set KEYCHAIN_PASSWORD
  printf '%s' "$apple_id" | gh secret set APPLE_ID
  printf '%s' "$app_pass" | gh secret set APPLE_PASSWORD
  printf '%s' "$team_id" | gh secret set APPLE_TEAM_ID
  echo
  gh secret list
}

case "${1:-}" in
  csr) cmd_csr ;;
  secrets) shift; cmd_secrets "$@" ;;
  *) echo "Usage : $0 csr | secrets <chemin du .cer>" >&2; exit 1 ;;
esac

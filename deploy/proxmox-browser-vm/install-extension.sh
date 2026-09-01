#!/usr/bin/env bash
set -euo pipefail

: "${EXTENSION_SOURCE:?set EXTENSION_SOURCE to the built extension directory}"
: "${DESKTOP_USER:=isekai-browser}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi
if [[ ! -r "${EXTENSION_SOURCE}/manifest.json" ]]; then
  echo "No manifest.json found in ${EXTENSION_SOURCE}. Run npm run build first." >&2
  exit 1
fi

install_root=/opt/isekai
extension_dir="${install_root}/chrome-extension"
feed_dir="${install_root}/extension-feed"
key_dir="${install_root}/extension-signing"
key_path="${key_dir}/isekai-extension.pem"
staging_dir="${install_root}/.chrome-extension.new"

install -d -o root -g root -m 0755 "${install_root}" "${feed_dir}"
install -d -o root -g root -m 0700 "${key_dir}"
rm -rf "${staging_dir}"
install -d -o root -g root -m 0755 "${staging_dir}"
cp -a "${EXTENSION_SOURCE}/." "${staging_dir}/"
chown -R root:root "${staging_dir}"
find "${staging_dir}" -type d -exec chmod 0755 {} +
find "${staging_dir}" -type f -exec chmod 0644 {} +

rm -rf "${extension_dir}"
mv "${staging_dir}" "${extension_dir}"
rm -f "${extension_dir}.crx" "${extension_dir}.pem"
if [[ -s "${key_path}" ]]; then
  google-chrome-stable --no-sandbox \
    --pack-extension="${extension_dir}" \
    --pack-extension-key="${key_path}"
else
  google-chrome-stable --no-sandbox --pack-extension="${extension_dir}"
  install -o root -g root -m 0600 "${extension_dir}.pem" "${key_path}"
  rm -f "${extension_dir}.pem"
fi

install -o root -g root -m 0644 "${extension_dir}.crx" "${feed_dir}/isekai-extension.crx"
extension_version="$(jq -r '.version' "${extension_dir}/manifest.json")"
public_der="$(mktemp)"
trap 'rm -f "${public_der}"' EXIT
openssl rsa -in "${key_path}" -pubout -outform DER -out "${public_der}" 2>/dev/null
extension_id="$(openssl dgst -sha256 -binary "${public_der}" | head -c 16 | xxd -p -c 32 | tr '0123456789abcdef' 'abcdefghijklmnop')"

updates_tmp="$(mktemp)"
policy_tmp="$(mktemp)"
trap 'rm -f "${public_der}" "${updates_tmp}" "${policy_tmp}"' EXIT
printf '%s\n' \
  '<?xml version="1.0" encoding="UTF-8"?>' \
  '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">' \
  "  <app appid=\"${extension_id}\">" \
  "    <updatecheck codebase=\"http://127.0.0.1:8765/isekai-extension.crx\" version=\"${extension_version}\" />" \
  '  </app>' \
  '</gupdate>' > "${updates_tmp}"
install -o root -g root -m 0644 "${updates_tmp}" "${feed_dir}/updates.xml"

printf '%s\n' \
  '{' \
  '  "BackgroundModeEnabled": true,' \
  '  "BrowserSignin": 0,' \
  '  "DefaultBrowserSettingEnabled": false,' \
  '  "ExtensionInstallSources": ["http://127.0.0.1:8765/*"],' \
  "  \"ExtensionInstallForcelist\": [\"${extension_id};http://127.0.0.1:8765/updates.xml\"]," \
  "  \"ExtensionSettings\": {\"${extension_id}\": {\"toolbar_pin\": \"force_pinned\"}}," \
  '  "MetricsReportingEnabled": false,' \
  '  "SyncDisabled": true' \
  '}' > "${policy_tmp}"
install -d -o root -g root -m 0755 /etc/opt/chrome/policies/managed
install -o root -g root -m 0644 "${policy_tmp}" \
  /etc/opt/chrome/policies/managed/isekai-extension.json

systemctl restart isekai-extension-feed.service
desktop_uid="$(id -u "${DESKTOP_USER}")"
if [[ -S "/run/user/${desktop_uid}/bus" ]]; then
  runuser -u "${DESKTOP_USER}" -- env \
    XDG_RUNTIME_DIR="/run/user/${desktop_uid}" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${desktop_uid}/bus" \
    systemctl --user try-restart isekai-chrome.service || true
fi

echo "Installed managed Isekai extension ${extension_id} version ${extension_version}."

#!/usr/bin/env bash
set -euo pipefail

: "${DESKTOP_USER:=isekai-browser}"
: "${RDP_USERNAME:=isekai}"
: "${RDP_PASSWORD:?set a unique RDP_PASSWORD at runtime}"
: "${LAN_CIDR:?set LAN_CIDR for SSH and RDP firewall access}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
desktop_home="$(getent passwd "${DESKTOP_USER}" | cut -d: -f6)"
desktop_uid="$(id -u "${DESKTOP_USER}")"
if [[ -z "${desktop_home}" ]]; then
  echo "Unknown desktop user: ${DESKTOP_USER}" >&2
  exit 1
fi

# gdm-custom.conf is intentionally templated with the generic cloud-init user.
sed "s/AutomaticLogin=isekai-browser/AutomaticLogin=${DESKTOP_USER}/" \
  "${script_dir}/files/gdm-custom.conf" > /run/isekai-gdm-custom.conf
install -o root -g root -m 0644 /run/isekai-gdm-custom.conf /etc/gdm3/custom.conf
rm -f /run/isekai-gdm-custom.conf

install -o root -g root -m 0755 "${script_dir}/files/isekai-chrome-launch" \
  /usr/local/bin/isekai-chrome-launch
install -o root -g root -m 0755 "${script_dir}/files/isekai-keyring" \
  /usr/local/bin/isekai-keyring
install -o root -g root -m 0644 "${script_dir}/files/isekai-extension-feed.service" \
  /etc/systemd/system/isekai-extension-feed.service
install -d -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0755 \
  "${desktop_home}/.config/systemd/user" "${desktop_home}/.config"
install -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0644 \
  "${script_dir}/files/isekai-chrome.service" \
  "${desktop_home}/.config/systemd/user/isekai-chrome.service"
install -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0644 \
  "${script_dir}/files/isekai-keyring.service" \
  "${desktop_home}/.config/systemd/user/isekai-keyring.service"
install -d -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0755 \
  "${desktop_home}/.config/systemd/user/gnome-remote-desktop.service.d"
install -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0644 \
  "${script_dir}/files/gnome-remote-desktop-isekai.conf" \
  "${desktop_home}/.config/systemd/user/gnome-remote-desktop.service.d/isekai.conf"
touch "${desktop_home}/.config/gnome-initial-setup-done"
chown "${DESKTOP_USER}:${DESKTOP_USER}" "${desktop_home}/.config/gnome-initial-setup-done"

rdp_dir="${desktop_home}/.local/share/gnome-remote-desktop"
install -d -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0755 \
  "${desktop_home}/.local" "${desktop_home}/.local/share"
install -d -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0700 "${rdp_dir}"
if [[ ! -s "${rdp_dir}/rdp-tls.key" || ! -s "${rdp_dir}/rdp-tls.crt" ]]; then
  openssl req -new -newkey rsa:3072 -days 3650 -nodes -x509 \
    -subj "/CN=$(hostname -f)" \
    -keyout "${rdp_dir}/rdp-tls.key" \
    -out "${rdp_dir}/rdp-tls.crt"
fi
chown "${DESKTOP_USER}:${DESKTOP_USER}" "${rdp_dir}/rdp-tls.key" "${rdp_dir}/rdp-tls.crt"
chmod 0600 "${rdp_dir}/rdp-tls.key"
chmod 0644 "${rdp_dir}/rdp-tls.crt"

run_grdctl() {
  timeout 15 runuser -u "${DESKTOP_USER}" -- env \
    HOME="${desktop_home}" \
    XDG_RUNTIME_DIR="/run/user/${desktop_uid}" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${desktop_uid}/bus" \
    grdctl "$@"
}

# Normal GNOME RDP mirrors the primary desktop. Headless mode creates a second
# blank monitor and leaves Chrome on the console display. A blank login keyring
# keeps the RDP secret available across GDM autologin; this dedicated VM already
# stores the recoverable RDP password in a mode-0600 file below.
install -d -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0700 \
  "${desktop_home}/.local/share/keyrings"
# Create only a missing or empty Login keyring. The isolated login/start pair is
# required so the keyring password can be initialized without a GUI prompt.
# Never replace a keyring containing items.
login_keyring="${desktop_home}/.local/share/keyrings/login.keyring"
if [[ -s "${login_keyring}" ]] && file "${login_keyring}" | grep -Fq '0 item(s)'; then
  mv "${login_keyring}" "${login_keyring}.empty-initial"
fi
if [[ ! -s "${login_keyring}" ]]; then
  loginctl disable-linger "${DESKTOP_USER}" || true
  systemctl stop "user@${desktop_uid}.service" || true
  runuser -u "${DESKTOP_USER}" -- env \
    HOME="${desktop_home}" \
    RDP_USERNAME="${RDP_USERNAME}" \
    RDP_PASSWORD="${RDP_PASSWORD}" \
    dbus-run-session -- bash -c '
      eval "$(printf "\n" | gnome-keyring-daemon --login)"
      export GNOME_KEYRING_CONTROL
      eval "$(gnome-keyring-daemon --start --components=secrets)"
      grdctl rdp set-credentials "${RDP_USERNAME}" "${RDP_PASSWORD}"
    '
fi

loginctl enable-linger "${DESKTOP_USER}"
systemctl start "user@${desktop_uid}.service"
runuser -u "${DESKTOP_USER}" -- env \
  HOME="${desktop_home}" \
  XDG_RUNTIME_DIR="/run/user/${desktop_uid}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${desktop_uid}/bus" \
  systemctl --user mask --now gnome-keyring-daemon.service \
    gnome-keyring-daemon.socket
runuser -u "${DESKTOP_USER}" -- env \
  HOME="${desktop_home}" \
  XDG_RUNTIME_DIR="/run/user/${desktop_uid}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${desktop_uid}/bus" \
  systemctl --user daemon-reload
runuser -u "${DESKTOP_USER}" -- env \
  HOME="${desktop_home}" \
  XDG_RUNTIME_DIR="/run/user/${desktop_uid}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${desktop_uid}/bus" \
  systemctl --user start isekai-keyring.service

run_grdctl rdp set-tls-key "${rdp_dir}/rdp-tls.key"
run_grdctl rdp set-tls-cert "${rdp_dir}/rdp-tls.crt"
run_grdctl rdp set-credentials "${RDP_USERNAME}" "${RDP_PASSWORD}"
run_grdctl rdp disable-view-only
run_grdctl rdp set-port 3389
run_grdctl rdp disable-port-negotiation
run_grdctl rdp enable

install -d -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 0700 \
  "${desktop_home}/.config/isekai"
credentials_file="${desktop_home}/.config/isekai/rdp-credentials"
printf 'username=%s\npassword=%s\n' "${RDP_USERNAME}" "${RDP_PASSWORD}" \
  > "${credentials_file}"
chown "${DESKTOP_USER}:${DESKTOP_USER}" "${credentials_file}"
chmod 0600 "${credentials_file}"

runuser -u "${DESKTOP_USER}" -- env \
  HOME="${desktop_home}" \
  XDG_RUNTIME_DIR="/run/user/${desktop_uid}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${desktop_uid}/bus" \
  systemctl --user enable isekai-keyring.service isekai-chrome.service \
    gnome-remote-desktop.service

# Keep the dedicated automation desktop awake and unlocked.
runuser -u "${DESKTOP_USER}" -- dbus-run-session -- \
  gsettings set org.gnome.desktop.session idle-delay 0
runuser -u "${DESKTOP_USER}" -- dbus-run-session -- \
  gsettings set org.gnome.desktop.screensaver lock-enabled false
runuser -u "${DESKTOP_USER}" -- dbus-run-session -- \
  gsettings set org.gnome.desktop.remote-desktop.rdp screen-share-mode 'extend'
runuser -u "${DESKTOP_USER}" -- dbus-run-session -- \
  gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
runuser -u "${DESKTOP_USER}" -- dbus-run-session -- \
  gsettings set org.gnome.shell favorite-apps \
  "['google-chrome.desktop', 'org.gnome.Nautilus.desktop', 'org.gnome.Terminal.desktop']"

systemctl set-default graphical.target
systemctl enable avahi-daemon isekai-extension-feed.service
systemctl mask systemd-networkd-wait-online.service
# Installing the desktop changes Netplan's implicit renderer to NetworkManager.
# Keep the cloud-init static address on networkd, matching the first boot.
netplan_file=/etc/netplan/50-cloud-init.yaml
if [[ -f "${netplan_file}" ]] && ! grep -Fq 'renderer: networkd' "${netplan_file}"; then
  sed -i '/^[[:space:]]*version: 2/a\  renderer: networkd' "${netplan_file}"
fi
netplan generate
systemctl enable systemd-networkd.service
systemctl daemon-reload

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from "${LAN_CIDR}" to any port 22 proto tcp
ufw allow from "${LAN_CIDR}" to any port 3389 proto tcp
ufw --force enable

# GDM owns the persistent desktop session. Linger would start the user manager
# before GDM and race the desktop keyring during boot.
loginctl disable-linger "${DESKTOP_USER}"

echo "Guest configuration complete. Reboot to start GNOME, RDP and Chrome."

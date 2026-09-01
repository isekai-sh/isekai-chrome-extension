#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root inside the Ubuntu VM." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

if [[ -n "${UBUNTU_MIRROR:-}" ]]; then
  sed -i "s|http://archive.ubuntu.com/ubuntu|${UBUNTU_MIRROR%/}|g" \
    /etc/apt/sources.list.d/ubuntu.sources
fi

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl dbus-x11 file gnome-keyring gnupg jq openssl qemu-guest-agent \
  ubuntu-desktop-minimal gdm3 gnome-remote-desktop avahi-daemon ufw xxd

install -d -o root -g root -m 0755 /etc/apt/keyrings
curl --fail --location --silent --show-error \
  https://dl.google.com/linux/linux_signing_key.pub \
  | gpg --dearmor --yes --output /etc/apt/keyrings/google-chrome.gpg
chmod 0644 /etc/apt/keyrings/google-chrome.gpg
printf '%s\n' \
  'deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' \
  > /etc/apt/sources.list.d/google-chrome.list
apt-get update
apt-get install -y google-chrome-stable

# Ubuntu Desktop recommends Firefox, but this appliance intentionally has one
# supported browser so operators never configure the extension in the wrong one.
snap remove firefox 2>/dev/null || true
apt-get purge -y firefox || true
apt-get autoremove -y

systemctl set-default graphical.target
systemctl enable avahi-daemon

echo "Base desktop installed. Run configure-guest.sh next."

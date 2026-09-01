#!/usr/bin/env bash
set -euo pipefail

# Run on a Proxmox VE node. Every artist gets a separate VM, IP and Chrome
# profile. Required values are deliberately passed as environment variables so
# this recipe never contains credentials or workstation-specific SSH keys.
: "${VMID:?set VMID (for example 1200)}"
: "${VM_NAME:?set VM_NAME (for example isekai-browser-owner)}"
: "${VM_IP:?set VM_IP without a prefix (for example 192.0.2.95)}"
: "${VM_GATEWAY:?set VM_GATEWAY for the target LAN}"
: "${VM_DNS:?set VM_DNS for the target LAN}"
: "${SSH_PUBLIC_KEY_FILE:?set SSH_PUBLIC_KEY_FILE to an existing public key}"

VM_CIDR="${VM_CIDR:-24}"
VM_BRIDGE="${VM_BRIDGE:-vmbr0}"
VM_STORAGE="${VM_STORAGE:-local-lvm}"
CLOUDINIT_STORAGE="${CLOUDINIT_STORAGE:-local-lvm}"
VM_USER="${VM_USER:-isekai-browser}"
VM_CORES="${VM_CORES:-4}"
VM_MEMORY_MIB="${VM_MEMORY_MIB:-8192}"
VM_DISK_GIB="${VM_DISK_GIB:-80}"
UBUNTU_RELEASE="${UBUNTU_RELEASE:-noble}"
IMAGE_NAME="${UBUNTU_RELEASE}-server-cloudimg-amd64.img"
IMAGE_BASE_URL="https://cloud-images.ubuntu.com/${UBUNTU_RELEASE}/current"
IMAGE_DIR="${IMAGE_DIR:-/var/lib/vz/template/iso}"
IMAGE_PATH="${IMAGE_DIR}/${IMAGE_NAME}"

if qm status "${VMID}" >/dev/null 2>&1; then
  echo "Refusing to overwrite existing VM ${VMID}."
  exit 1
fi

if [[ ! -r "${SSH_PUBLIC_KEY_FILE}" ]]; then
  echo "Cannot read SSH public key: ${SSH_PUBLIC_KEY_FILE}" >&2
  exit 1
fi

install -d -m 0755 "${IMAGE_DIR}"
curl --fail --location --output "${IMAGE_PATH}.SHA256SUMS" \
  "${IMAGE_BASE_URL}/SHA256SUMS"
expected_sha256="$(awk -v file="${IMAGE_NAME}" '$2 == "*" file || $2 == file {print $1; exit}' "${IMAGE_PATH}.SHA256SUMS")"
if [[ -z "${expected_sha256}" ]]; then
  echo "Ubuntu checksum file did not contain ${IMAGE_NAME}." >&2
  exit 1
fi
if [[ -r "${IMAGE_PATH}" ]] && \
   printf '%s  %s\n' "${expected_sha256}" "${IMAGE_PATH}" | sha256sum --check -; then
  echo "Using verified cached image ${IMAGE_PATH}."
else
  curl --fail --location --output "${IMAGE_PATH}.download" \
    "${IMAGE_BASE_URL}/${IMAGE_NAME}"
  printf '%s  %s\n' "${expected_sha256}" "${IMAGE_PATH}.download" | sha256sum --check -
  mv --force "${IMAGE_PATH}.download" "${IMAGE_PATH}"
fi

qm create "${VMID}" \
  --name "${VM_NAME}" \
  --description "Dedicated one-user Ubuntu GNOME and Google Chrome Isekai automation VM" \
  --tags isekai \
  --ostype l26 \
  --machine q35 \
  --cpu host \
  --cores "${VM_CORES}" \
  --memory "${VM_MEMORY_MIB}" \
  --balloon 0 \
  --scsihw virtio-scsi-single \
  --net0 "virtio,bridge=${VM_BRIDGE},firewall=1" \
  --vga virtio \
  --serial0 socket \
  --agent enabled=1 \
  --onboot 1 \
  --startup order=40,up=60,down=60

qm importdisk "${VMID}" "${IMAGE_PATH}" "${VM_STORAGE}"
qm set "${VMID}" --scsi0 "${VM_STORAGE}:vm-${VMID}-disk-0,discard=on,ssd=1"
qm resize "${VMID}" scsi0 "${VM_DISK_GIB}G"
qm set "${VMID}" --ide2 "${CLOUDINIT_STORAGE}:cloudinit"
qm set "${VMID}" --boot order=scsi0
qm set "${VMID}" --ciuser "${VM_USER}"
qm set "${VMID}" --sshkeys "${SSH_PUBLIC_KEY_FILE}"
qm set "${VMID}" --ipconfig0 "ip=${VM_IP}/${VM_CIDR},gw=${VM_GATEWAY}"
qm set "${VMID}" --nameserver "${VM_DNS}" --searchdomain local
qm cloudinit update "${VMID}"
qm start "${VMID}"

echo "VM ${VMID} started at ${VM_IP}; wait for cloud-init before running bootstrap-guest.sh."

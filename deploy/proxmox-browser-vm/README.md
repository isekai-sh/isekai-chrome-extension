# Dedicated Isekai browser VM

This recipe creates one Ubuntu GNOME VM per artist. Never share a VM, Linux
account, Chrome profile, DeviantArt session, or Isekai API key between artists.

## Baseline

- Ubuntu 24.04 LTS GNOME
- Official Google Chrome stable
- 4 vCPU, 8 GiB RAM, 80 GiB disk
- Static LAN address
- Direct RDP on TCP 3389 (Remmina/FreeRDP and Windows Remote Desktop)
- RDP creates a virtual monitor so Remmina and Windows clients can resize the
  desktop dynamically
- SSH public-key access for maintenance
- Chrome and the Isekai extension start automatically after reboot

## Create the VM

Run `create-vm.sh` as root on the selected Proxmox node. The script refuses to
overwrite an existing VM and verifies the Ubuntu cloud image against Ubuntu's
published SHA-256 list.

```bash
VMID=1200 \
VM_NAME=ubuntu-owner \
VM_IP=192.0.2.95 \
VM_GATEWAY=192.0.2.1 \
VM_DNS=192.0.2.53 \
SSH_PUBLIC_KEY_FILE=./operator.pub \
VM_STORAGE=local-lvm \
./create-vm.sh
```

Use a new VMID and IP for every additional artist. After cloud-init completes,
copy and run `bootstrap-guest.sh`, run `configure-guest.sh`, then deploy a built
extension with `install-extension.sh`.

```bash
LAN_CIDR=192.0.2.0/24 \
RDP_PASSWORD='generate-a-unique-password' sudo -E ./configure-guest.sh
EXTENSION_SOURCE=/tmp/isekai-extension-dist sudo -E ./install-extension.sh
```

`install-extension.sh` packages the extension as a CRX and force-installs it
through a loopback-only managed update feed. This is required for current
official Google Chrome builds, which do not support relying on the development
`--load-extension` switch. The signing key stays root-only inside the VM so
future deployments keep the same extension ID and Chrome storage.

RDP and extension credentials are runtime inputs. Do not commit them to this
directory or bake them into a VM image.

The dedicated account uses an empty GNOME login-keyring password. A user
service starts that keyring before GNOME Remote Desktop, avoiding the keyring
race caused by GDM autologin. The VM is therefore the security boundary: keep
SSH key-only, retain the LAN-only firewall rule, and never reuse this VM or its
credentials for another artist.

## Connect

- Linux: create a Remmina RDP profile for `<VM_IP>:3389` with clipboard enabled.
- Windows: open Remote Desktop Connection and enter `<VM_IP>:3389`.
- SSH remains available with the cloud-init user and authorized public key.

The RDP username/password passed to `configure-guest.sh` are also written to
`~/.config/isekai/rdp-credentials` inside the VM with mode `0600`, so the owner
can recover them over key-authenticated SSH. Do not copy that file into this
repository or shared storage.

#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ $EUID != 0 ]] || { echo 'Eseguire come utente desktop, non con sudo.' >&2; exit 1; }
uuid=inference-mode@local
extension="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
helper=/usr/local/libexec/inference-mode
policy=/usr/share/polkit-1/actions/io.github.inference_mode.policy
unit=/etc/systemd/system/inference-mode-restore@.service
case ${1:-install} in
install)
    [[ $(gnome-shell --version) == 'GNOME Shell 50.'* ]] || { echo 'Richiede GNOME 50.' >&2; exit 1; }
    command -v pkexec powerprofilesctl flock loginctl systemctl >/dev/null
    bash -n apply.sh
    sudo install -D -m 755 apply.sh "$helper"
    sudo install -m 644 inference-mode.policy "$policy"
    sudo install -m 644 inference-mode-restore@.service "$unit"
    sudo systemctl daemon-reload
    # Also protect Inference if it was already active before this update.
    if [[ -f /run/inference-mode.dpm ]]; then
        pkexec "$helper" inference
    fi
    mkdir -p "$extension"
    install -m 644 extension/extension.js extension/metadata.json "$extension/"
    if gnome-extensions list | grep -Fxq "$uuid"; then
        gnome-extensions enable "$uuid"
    else
        echo 'Installed. Log out and back in so GNOME can discover the extension.'
        echo "Then run: gnome-extensions enable $uuid"
    fi
    ;;
remove)
    [[ ! -f $helper ]] || pkexec "$helper" off
    # Do not delete the files if Shell fails to disable the extension: its
    # replacement tile could disappear without the native one being restored.
    if gnome-extensions list | grep -Fxq "$uuid"; then
        gnome-extensions disable "$uuid"
    fi
    sudo systemctl stop 'inference-mode-restore@*.service'
    sudo rm -f -- "$helper" "$policy" "$unit" /run/inference-mode.lock
    sudo systemctl daemon-reload
    rm -f -- "$extension/extension.js" "$extension/metadata.json"
    [[ ! -d $extension ]] || rmdir "$extension"
    ;;
*) echo 'Uso: ./install.sh [install|remove]' >&2; exit 2 ;;
esac

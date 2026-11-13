#!/usr/bin/env bash
# Installed as /usr/local/libexec/inference-mode; run through pkexec.
set -euo pipefail
case ${1:-} in
    inference|balanced|performance|power-saver|off|session-end) mode=$1 ;;
    *) echo 'Uso: inference-mode inference|balanced|performance|power-saver|off' >&2; exit 2 ;;
esac
[[ $EUID == 0 ]] || { echo 'Richiede pkexec.' >&2; exit 1; }
exec 9>/run/inference-mode.lock
flock 9
state=/run/inference-mode.dpm
if [[ $mode == off || $mode == session-end ]]; then
    [[ -f $state ]] || exit 0
fi

# Refuse ambiguous GPU selection.
gpus=()
for file in /sys/class/drm/card*/device/power_dpm_force_performance_level; do
    [[ -f $file ]] || continue
    device=${file%/*}
    [[ $(< "$device/vendor") == 0x1002 && $(readlink "$device/driver") == */amdgpu ]] && gpus+=("$file")
done
[[ ${#gpus[@]} == 1 ]] || { echo 'Attesa una sola GPU AMD con DPM.' >&2; exit 1; }
gpu=${gpus[0]}

restore() {
    [[ -f $state ]] || return 0
    previous=$(< "$state")
    case $previous in
        auto|low|high|manual|profile_standard|profile_min_sclk|profile_min_mclk|profile_peak) ;;
        *) echo 'Valore DPM salvato non valido.' >&2; return 1 ;;
    esac
    printf '%s\n' "$previous" > "$gpu"
    rm -- "$state"
}

if [[ $mode == inference ]]; then
    # Arm a root-owned cleanup before changing GPU settings. Unlike pkexec from
    # the extension, this remains authorized while the desktop is logging out.
    uid=${PKEXEC_UID:-${SUDO_UID:-}}
    [[ $uid =~ ^[0-9]+$ ]] || { echo 'Eseguire inference tramite pkexec dalla sessione desktop.' >&2; exit 1; }
    session=$(loginctl show-user "$uid" --property=Display --value)
    [[ $session =~ ^[a-zA-Z0-9]+$ ]] || { echo 'Sessione grafica non trovata.' >&2; exit 1; }
    scope="session-$session.scope"
    [[ $(loginctl show-session "$session" --property=User --value) == "$uid" ]] || exit 1
    systemctl is-active --quiet "$scope" || { echo 'Sessione non attiva.' >&2; exit 1; }
    systemctl start "inference-mode-restore@session-$session.service"
    [[ -f $state ]] || { umask 022; printf '%s\n' "$(< "$gpu")" > "$state"; }
    if ! powerprofilesctl set balanced || ! printf 'high\n' > "$gpu" || [[ $(< "$gpu") != high ]]; then
        restore
        echo 'Attivazione Inference fallita.' >&2
        exit 1
    fi
elif [[ $mode == session-end ]]; then
    # Still attempt balanced if restoring DPM fails.
    status=0
    restore || status=$?
    powerprofilesctl set balanced || status=$?
    exit "$status"
else
    restore
    [[ $mode == off ]] || powerprofilesctl set "$mode"
fi

# Inference Mode for GNOME

A GNOME Quick Settings extension that adds an **Inference** power mode for local AI workloads on AMD GPUs.

It keeps the **balanced** system power profile and sets the AMD GPU's `power_dpm_force_performance_level` to **high**. Switching out of Inference restores the GPU's previous DPM setting.

Tested and working on GNOME Shell 50 with an AMD GPU, including installation, profile switching, GPU DPM restoration, session-end cleanup, and uninstallation.

## Requirements

- **GNOME Shell 50**. The extension uses internal Shell APIs; other versions are not supported.
- Exactly **one AMD GPU** using the `amdgpu` driver and exposing `power_dpm_force_performance_level`.
- `power-profiles-daemon`, `pkexec`/polkit, Bash, `flock`, systemd (`systemctl` and `loginctl`), and `gnome-extensions`.
- Administrator access for installation.

## Installation

From the project directory, run as your normal desktop user, **not as root**:

```bash
./install.sh
```

The installer uses `sudo` to install the privileged helper and polkit policy, and installs the extension for your user.

**After the first installation, log out of GNOME and log back in.** GNOME may not discover a newly installed extension until the session is restarted; this was required in the tested Wayland session. Save your work before logging out. A full system reboot is not necessary.

Then enable the extension:

```bash
gnome-extensions enable inference-mode@local
```

To check that it loaded:

```bash
gnome-extensions info inference-mode@local
```

The extension should be enabled and its state should be `ACTIVE`. At login it waits for GNOME's power tile to be ready before initializing.

## Usage

Open GNOME Quick Settings in the top-right corner:

- Click the power tile to toggle between **Inference** and **Balanced**.
- Open the tile's arrow menu to select **Power Saver**, **Balanced**, **Performance**, or **Inference**.

Standard profile names use GNOME Shell's translations and follow the system interface language, just like the native power menu. **Inference** keeps its custom name.

Disable Inference when you finish your workload. If it is still active at **logout, restart, or normal shutdown**, a systemd cleanup unit automatically restores the previous GPU DPM setting and selects **Balanced**. If you have already left Inference, it leaves your chosen power profile unchanged.

Only the Quick Settings extension displays “Inference”. GNOME's system power settings and `powerprofilesctl` still report `balanced`.

## Verify that it is working

With Inference enabled:

```bash
powerprofilesctl get
# Expected: balanced

# Print the DPM setting for each GPU exposing this attribute:
for file in /sys/class/drm/card*/device/power_dpm_force_performance_level; do
    [ -f "$file" ] || continue
    printf '%s: ' "$file"
    cat "$file"
done
# Expected for the AMD GPU: high

cat /run/inference-mode.dpm
# The previous GPU DPM setting, often auto
```

Select **Balanced** in the extension's menu to check restoration: the GPU DPM setting should return to the saved value, and `/run/inference-mode.dpm` should no longer exist.

## Limitations and recovery

- **Session cleanup, not a watchdog:** automatic restoration is tied to the graphical session ending. A GNOME Shell crash that leaves the session running, or a cleanup failure, can leave GPU DPM at `high`. Screen locking is not a session end. Forced power-off or a system crash cannot run cleanup. To restore the saved DPM setting manually:

  ```bash
  pkexec /usr/local/libexec/inference-mode off
  ```

  This command leaves the current system power profile unchanged.

- Selecting `balanced` in another application while that profile is already active cannot disable Inference. Use the extension or the recovery command above.
- The extension relies on GNOME Shell's internal Quick Settings APIs and may need changes for future GNOME releases.

## Security

Installation places a root-owned helper at `/usr/local/libexec/inference-mode` and a polkit policy under `/usr/share/polkit-1/actions/`. The policy allows active local sessions to invoke this helper without a password prompt. The helper accepts only the supported power modes and refuses ambiguous GPU selection.

Review `apply.sh` and `inference-mode.policy` before installing.

## Uninstall

From the project directory, as your desktop user:

```bash
./install.sh remove
```

This restores the saved GPU DPM setting, disables the extension to restore GNOME's native power tile, and removes the helper, policy, and user extension. The current system power profile is left unchanged. Removal stops if GNOME reports an error disabling a registered extension.

When updating an existing installation, log out and back in to load the updated extension code.

## Project files

- `extension/extension.js`: GNOME Quick Settings integration.
- `extension/metadata.json`: extension metadata and supported GNOME version.
- `apply.sh`: privileged power-profile and GPU DPM helper.
- `inference-mode.policy`: polkit authorization for the helper.
- `inference-mode-restore@.service`: automatic session-end cleanup.
- `install.sh`: installation and removal.

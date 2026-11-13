import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Gettext from 'gettext';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const HELPER = '/usr/local/libexec/inference-mode';
const STATE = '/run/inference-mode.dpm';
// Use Shell's translations so standard labels match the native power menu.
const _ = Gettext.domain('gnome-shell').gettext;
const MODES = [
    ['power-saver', _('Power Saver'), 'power-profile-power-saver-symbolic'],
    ['balanced', _('Balanced'), 'power-profile-balanced-symbolic'],
    ['performance', _('Performance'), 'power-profile-performance-symbolic'],
    ['inference', 'Inference', 'applications-science-symbolic'],
];
const Toggle = GObject.registerClass(class InferenceToggle extends QuickMenuToggle {});

export default class InferenceExtension extends Extension {
    enable() {
        this._alive = true;
        this._quick = Main.panel.statusArea.quickSettings;
        // GNOME creates its Quick Settings indicators asynchronously at login.
        this._startup = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this._quick._powerProfiles)
                return GLib.SOURCE_CONTINUE;
            this._startup = 0;
            this._setup();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setup() {
        this._native = this._quick._powerProfiles;
        this._proxy = this._native._powerProfilesToggle._proxy;
        this._indicator = new SystemIndicator();
        this._toggle = new Toggle({title: _('Power Mode'), toggleMode: false});
        this._toggle.menu.setHeader('applications-science-symbolic', _('Power Mode'));
        this._items = new Map();
        for (const [mode, title, icon] of MODES) {
            const item = new PopupMenu.PopupImageMenuItem(title, icon);
            item.connect('activate', () => this._run(mode));
            this._toggle.menu.addMenuItem(item);
            this._items.set(mode, item);
        }
        this._toggle.menuEnabled = true;
        this._toggle.connect('clicked', () =>
            this._run(this._mode === 'inference' ? 'balanced' : 'inference'));
        this._indicator.quickSettingsItems.push(this._toggle);
        this._quick.addExternalIndicator(this._indicator);
        this._nativeItems = this._native.quickSettingsItems.map(item => ({
            item,
            signal: item.connect('notify::visible', () => { if (item.visible) item.hide(); }),
        }));
        this._nativeItems.forEach(({item}) => item.hide());
        this._native.hide();
        this._changed = this._proxy.connect('g-properties-changed', () => this._sync());
        this._opened = this._quick.menu.connect('open-state-changed', () => this._sync());
        this._sync();
    }

    _sync() {
        if (!this._alive || this._busy)
            return;
        const profile = this._proxy.ActiveProfile;
        const inference = GLib.file_test(STATE, GLib.FileTest.IS_REGULAR);
        if (inference && profile && profile !== 'balanced') {
            this._run('off'); // External profile changes override Inference.
            return;
        }
        this._mode = inference ? 'inference' : profile;
        const entry = MODES.find(([mode]) => mode === this._mode);
        this._toggle.subtitle = entry?.[1] ?? _('Unavailable');
        this._toggle.iconName = entry?.[2] ?? 'applications-science-symbolic';
        this._toggle.checked = this._mode === 'inference';
        for (const [mode, item] of this._items)
            item.setOrnament(mode === this._mode ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
    }

    _run(mode) {
        if (this._busy)
            return;
        this._busy = true;
        try {
            const process = Gio.Subprocess.new(['pkexec', HELPER, mode],
                Gio.SubprocessFlags.STDERR_PIPE);
            process.communicate_utf8_async(null, null, (proc, result) => {
                const [, , error] = proc.communicate_utf8_finish(result);
                this._busy = false;
                if (!this._alive)
                    return;
                if (!proc.get_successful())
                    Main.notifyError('Inference', error.trim() || 'Operazione fallita');
                else
                    this._sync();
            });
        } catch (error) {
            this._busy = false;
            Main.notifyError('Inference', error.message);
        }
    }

    disable() {
        this._alive = false;
        if (this._startup) {
            GLib.Source.remove(this._startup);
            this._startup = 0;
        }
        if (this._changed)
            this._proxy.disconnect(this._changed);
        if (this._opened)
            this._quick.menu.disconnect(this._opened);
        this._nativeItems?.forEach(({item, signal}) => item.disconnect(signal));
        // The proxy may not have been ready at enable(), so a saved visibility
        // can be stale. Let GNOME recompute it from the current daemon state.
        this._native?._powerProfilesToggle._sync();
        this._native?._syncIndicatorsVisible();
        this._toggle?.destroy();
        this._indicator?.destroy();
        this._changed = 0;
        this._opened = 0;
        this._nativeItems = null;
        this._native = null;
        this._toggle = null;
        this._indicator = null;
        // UI restoration must not depend on launching the privileged helper.
        try {
            Gio.Subprocess.new(['pkexec', HELPER, 'off'], Gio.SubprocessFlags.NONE);
        } catch (error) {
            console.error(`Inference: impossibile ripristinare DPM: ${error.message}`);
        }
    }
}

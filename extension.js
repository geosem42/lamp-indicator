const St = imports.gi.St;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const PopupImageMenuItem = imports.ui.popupMenu.PopupImageMenuItem;
const Util = imports.misc.util;
const ByteArray = imports.byteArray;

let serviceControlButton, apache2, mysql;

function createMenuItem(labelText, iconName, activateCallback) {
    let menuItem = new PopupMenu.PopupBaseMenuItem();
    let label = new St.Label({ text: labelText });
    let icon = new St.Icon({ icon_name: iconName, style_class: 'popup-menu-icon' });
    let spacer = new St.Bin({ x_expand: true });

    menuItem.actor.add_child(label);
    menuItem.actor.add_child(spacer);
    menuItem.actor.add_child(icon);
    menuItem.connect('activate', activateCallback);

    return menuItem;
}

function init() {
    let icon = new St.Icon({ icon_name: 'network-server', style_class: 'system-status-icon' });
    serviceControlButton = new PanelMenu.Button(0.0, "Service Control", false);
    serviceControlButton.add_actor(icon);

    let menu = serviceControlButton.menu;

    apache2 = new PopupMenu.PopupSwitchMenuItem("Apache2", false);
    mysql = new PopupMenu.PopupSwitchMenuItem("MySQL", false);

    // Override activate method for each switch
    [apache2, mysql].forEach(item => {
        item.activate = function (event) {
            this.toggle();
        };
    });

    apache2.connect('toggled', toggleApache2);
    mysql.connect('toggled', toggleMySQL);

    // Get PHP version
    let [res, out, err, status] = GLib.spawn_command_line_sync('php -v');
    let phpVersion = ByteArray.toString(out).split('\n')[0].split(' ')[1];

    // Create new menu item for PHP version
    let phpVersionMenuItem = new PopupMenu.PopupBaseMenuItem();
    let phpLabel = new St.Label({ text: "PHP" });
    let versionLabel = new St.Label({ text: phpVersion });
    let spacer = new St.Bin({ x_expand: true });

    phpVersionMenuItem.actor.add_child(phpLabel);
    phpVersionMenuItem.actor.add_child(spacer);
    phpVersionMenuItem.actor.add_child(versionLabel);

    let editMenuItem = createMenuItem("Edit php.ini", 'document-edit-symbolic', _openPHPIni);
    let editHttpdMenuItem = createMenuItem("Edit httpd.conf", 'document-edit-symbolic', _openHttpdConf);
    let editMyCnfMenuItem = createMenuItem("Edit my.cnf", 'document-edit-symbolic', _openMyCnf);

    menu.addMenuItem(apache2);
    menu.addMenuItem(mysql);
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    menu.addMenuItem(phpVersionMenuItem);
    menu.addMenuItem(editMenuItem);
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    menu.addMenuItem(editHttpdMenuItem);
    menu.addMenuItem(editMyCnfMenuItem);
}
function enable() {
    let tmpFile = Gio.File.new_tmp("apache2_status_XXXXXX")[0];
    GLib.spawn_command_line_async(`bash -c "systemctl is-active apache2 > ${tmpFile.get_path()}"`);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        let [success, contents] = GLib.file_get_contents(tmpFile.get_path());
        let isActive = (ByteArray.toString(contents) === 'active\n');
        apache2.setToggleState(isActive);
        tmpFile.delete(null);
        return GLib.SOURCE_REMOVE;
    });

    let tmpFileMySQL = Gio.File.new_tmp("mysql_status_XXXXXX")[0];
    GLib.spawn_command_line_async(`bash -c "systemctl is-active mysql > ${tmpFileMySQL.get_path()}"`);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        let [success, contents] = GLib.file_get_contents(tmpFileMySQL.get_path());
        let isActive = (ByteArray.toString(contents) === 'active\n');
        mysql.setToggleState(isActive);
        tmpFileMySQL.delete(null);
        return GLib.SOURCE_REMOVE;
    });

    Main.panel.addToStatusArea('serviceControlButton', serviceControlButton);
}

function disable() {
    serviceControlButton.destroy();
}

function toggleApache2(item, state) {
    let command = state ? ['pkexec', 'systemctl', 'start', 'apache2'] : ['pkexec', 'systemctl', 'stop', 'apache2'];
    let subprocess = new Gio.Subprocess({ argv: command, flags: Gio.SubprocessFlags.STDOUT_SILENCE });
    subprocess.init(null);
    subprocess.wait_check_async(null, function (subprocess, result) {
        try {
            subprocess.wait_check_finish(result);
        } catch (e) {
            logError(e);
        }
    });
}

function toggleMySQL(item, state) {
    let command = state ? ['pkexec', 'systemctl', 'start', 'mysql'] : ['pkexec', 'systemctl', 'stop', 'mysql'];
    let subprocess = new Gio.Subprocess({ argv: command, flags: Gio.SubprocessFlags.STDOUT_SILENCE });
    subprocess.init(null);
    subprocess.wait_check_async(null, function (subprocess, result) {
        try {
            subprocess.wait_check_finish(result);
        } catch (e) {
            logError(e);
        }
    });
}

function _openPHPIni() {
    // Run 'php --ini' command
    let [res, out, err, status] = GLib.spawn_command_line_sync('php --ini');
    if (status !== 0) return;

    // Find the line with 'Loaded Configuration File'
    let lines = ByteArray.toString(out).split('\n');
    let loadedConfigLine = lines.find(line => line.includes('Loaded Configuration File'));

    if (!loadedConfigLine) return;

    // Extract the path to the php.ini file from the line
    let phpIniPath = loadedConfigLine.split(': ')[1].trim();

    // Log the php.ini file path
    global.log(`Opening php.ini file at: ${phpIniPath}`);

    // Get the default terminal emulator
    let terminal = GLib.getenv('TERMINAL') || 'x-terminal-emulator';

    // Open php.ini in a text editor with root privileges
    let command = `${terminal} -e 'pkexec nano ${phpIniPath}'`;
    GLib.spawn_command_line_async(command);
}

function _openHttpdConf() {
    // Run 'apache2ctl -V' command
    let [ok, apacheOut, apacheErr, exit] = GLib.spawn_command_line_sync("apache2ctl -V");

    if (exit !== 0) {
        global.log('Failed to run apache2ctl -V command');
        return;
    }

    // Convert the output to a string
    let apacheOutStr = ByteArray.toString(apacheOut);

    // Find the line with 'SERVER_CONFIG_FILE' and 'HTTPD_ROOT'
    let lines = apacheOutStr.split('\n');
    let serverConfigLine = lines.find(line => line.includes('SERVER_CONFIG_FILE'));
    let httpdRootLine = lines.find(line => line.includes('HTTPD_ROOT'));

    if (!serverConfigLine || !httpdRootLine) return;

    // Extract the path to the apache2.conf file and the HTTPD_ROOT from the lines
    let apacheConfFile = serverConfigLine.split('=')[1].trim().replace(/"/g, '');
    let httpdRoot = httpdRootLine.split('=')[1].trim().replace(/"/g, '');

    // Combine HTTPD_ROOT and apache2.conf file to get the full path
    let apacheConfPath = `${httpdRoot}/${apacheConfFile}`;

    // Log the apache2.conf file path
    global.log(`Opening apache2.conf file at: ${apacheConfPath}`);

    // Get the default terminal emulator
    let terminal = GLib.getenv('TERMINAL') || 'x-terminal-emulator';

    // Open apache2.conf in a text editor with root privileges
    let command = `${terminal} -e 'pkexec nano ${apacheConfPath}'`;
    GLib.spawn_command_line_async(command);
}

function _openMyCnf() {
    // Get the default terminal emulator
    let terminal = GLib.getenv('TERMINAL') || 'x-terminal-emulator';

    // Open my.cnf in a text editor with root privileges
    let command = `${terminal} -e 'pkexec nano /etc/mysql/my.cnf'`;
    GLib.spawn_command_line_async(command);
}
/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// = Application Display =
//
// In the {{{js.ui.appDisplay}}} module, the {{{AppDisplay}}} and
// {{{AppDisplayItem}}} classes are defined to manage displaying a collection of
// application items.

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Shell = imports.gi.Shell;
const Signals = imports.signals;

const GenericDisplay = imports.ui.genericDisplay;

// == {{{DEFAULT_APPLICATIONS}}} ==
//
// These are the applications shown by default.  This list is taken from
// [[http://online.gnome.org/applications|GNOME Online popular applications]]
// but with nautilus removed (since it should already be running) and evince,
// totem, and gnome-file-roller removed (since they're usually started by
// opening documents, not by opening the app directly).
//
// **TODO:** move this into GConf once we're not a plugin anymore but have
// taken over metacity.

const DEFAULT_APPLICATIONS = [
    'mozilla-firefox.desktop',
    'gnome-terminal.desktop',
    'evolution.desktop',
    'gedit.desktop',
    'mozilla-thunderbird.desktop',
    'rhythmbox.desktop',
    'epiphany.desktop',
    'xchat.desktop',
    'openoffice.org-1.9-writer.desktop',
    'emacs.desktop',
    'gnome-system-monitor.desktop',
    'openoffice.org-1.9-calc.desktop',
    'eclipse.desktop',
    'openoffice.org-1.9-impress.desktop',
    'vncviewer.desktop'
];

// == {{{AppDisplayItem(appInfo, availableWidth)}}} ==
//
// This class represents a single display item containing information about an
// application.
//
// * {{{appInfo}}} - {{{GAppInfo}}} object containing information about the
//                   application
// * {{{availableWidth}}} - total width available for the item

function AppDisplayItem(appInfo, availableWidth) {
    this._init(appInfo, availableWidth);
}

AppDisplayItem.prototype = {
    __proto__:  GenericDisplay.GenericDisplayItem.prototype,

    _init : function(appInfo, availableWidth) {
        GenericDisplay.GenericDisplayItem.prototype._init.call(this,
                                                               availableWidth);
        this._appInfo = appInfo;

        let name = appInfo.get_name();

        let description = appInfo.get_description();

        let iconTheme = Gtk.IconTheme.get_default();

        let icon = new Clutter.Texture({ width:
                                         GenericDisplay.ITEM_DISPLAY_ICON_SIZE,
                                         height:
                                         GenericDisplay.ITEM_DISPLAY_ICON_SIZE});
        let gicon = appInfo.get_icon();
        let path = null;
        if (gicon != null) {
            let iconinfo = iconTheme.lookup_by_gicon(gicon,
                                                     GenericDisplay.ITEM_DISPLAY_ICON_SIZE,
                                                     Gtk.IconLookupFlags.NO_SVG);
            if (iconinfo)
                path = iconinfo.get_filename();
        }

        if (path) {
            try {
                icon.set_from_file(path);
                icon.x = GenericDisplay.ITEM_DISPLAY_PADDING;
                icon.y = GenericDisplay.ITEM_DISPLAY_PADDING;
            } catch (e) {
                // we can get an error here if the file path doesn't exist on
                // the system
                log('Error loading AppDisplayItem icon ' + e);
            }
        }
        this._setItemInfo(name, description, icon); 
    },

    // === Public methods ===

    // ==== {{{AppDisplayItem.getAppInfo()}}} ====
    //
    // Returns the application info associated with this display item.

    getAppInfo : function () {
        return this._appInfo;
    },

    // === Public method overrides ===

    // ==== {{{AppDisplayItem.launch()}}} ====
    //
    // Opens an application represented by this display item.

    launch : function() {
        let global = Shell.Global.get();
        let screen = global.screen;
        let display = screen.get_display();
        let timestamp = display.get_current_time();
        let context = new Gdk.AppLaunchContext();
        let icon = this._appInfo.get_icon();
        context.set_icon(icon);
        context.set_timestamp(timestamp);
        this._appInfo.launch([], context);
    }

};

// == {{{AppDisplay(width, height, numberOfColumns, columnGap)}}} ==
//
// This class represents a display containing a collection of application items.
// The applications are sorted based on their popularity by default, and based
// on their name if some search filter is applied.
//
// * {{{width}}} - width available for the display
// * {{{height}}} - height available for the display

function AppDisplay(width, height, numberOfColumns, columnGap) {
    this._init(width, height, numberOfColumns, columnGap);
}

AppDisplay.prototype = {
    __proto__:  GenericDisplay.GenericDisplay.prototype,

    _init : function(width, height, numberOfColumns, columnGap) {
        GenericDisplay.GenericDisplay.prototype._init.call(this, width, height,
                                                           numberOfColumns,
                                                           columnGap);

        // map<itemId, array of category names>
        this._categories = {};
  
        let me = this;
        this._appMonitor = new Shell.AppMonitor();
        this._appsStale = true;
        this._appMonitor.connect('changed', function(mon) {
            me._appsStale = true;
            // We still need to determine what events other than search can
            // trigger a change in the set of applications that are being shown
            // while the user in in the overlay mode, however let's redisplay
            // just in case.
            me._redisplay(); 
        });

        // Load the GAppInfos now so it doesn't slow down the first
        // transition into the overlay.
        this._refreshCache();
    },

    // === Protected method overrides ===

    // ==== {{{AppDisplay._refreshCache()}}} ====
    //
    // Gets information about all applications by calling
    // {{{Gio.app_info_get_all()}}}.

    _refreshCache : function() {
        let me = this;
        if (!this._appsStale)
            return;
        this._allItems = {};
        this._categories = {}; 
        let apps = Gio.app_info_get_all();
        for (let i = 0; i < apps.length; i++) {
            let appInfo = apps[i];
            
            if (!appInfo.should_show())
                continue;
            
            let appId = appInfo.get_id();
            this._allItems[appId] = appInfo;
            // [] is returned if we could not get the categories or the list of
            // categories was empty
            let categories = Shell.get_categories_for_desktop_file(appId);
            this._categories[appId] = categories;
        }
        this._appsStale = false;
    },

    // ==== {{{AppDisplay._setDefaultList()}}} ====
    //
    // Sets the list of the displayed items based on the list of
    // {{{DEFAULT_APPLICATIONS}}}.

    _setDefaultList : function() {
        this._removeAllDisplayItems();
        let added = 0;
        for (let i = 0;
             i < DEFAULT_APPLICATIONS.length && added < this._maxItems;
             i++) {
            let appId = DEFAULT_APPLICATIONS[i];
            let appInfo = this._allItems[appId];
            if (appInfo) {
                this._addDisplayItem(appId);
                added += 1;
            }
        }
    },

    // ==== {{{AppDisplay._compareItems(itemIdA, itemIdB)}}} ==== 
    //
    // Compares items associated with the item ids based on the alphabetical
    // order of the item names.
    // Returns an integer value indicating the result of the comparison.

    _compareItems : function(itemIdA, itemIdB) {
        let appA = this._allItems[itemIdA];
        let appB = this._allItems[itemIdB];
        return appA.get_name().localeCompare(appB.get_name());
    },

    // ==== {{{AppDisplay._isInfoMatching(itemInfo, search)}}} ====
    // Checks if the item info can be a match for the search string by checking
    // the name, description, execution command, and categories for the
    // application.
    //
    // The argument {{{itemInfo}}} is expected to be {{{GAppInfo}}}.
    // Returns a boolean flag indicating if {{{itemInfo}}} is a match.

    _isInfoMatching : function(itemInfo, search) {
        if (search == null || search == '')
            return true;

        let name = itemInfo.get_name().toLowerCase();
        if (name.indexOf(search) >= 0)
            return true;

        let description = itemInfo.get_description();
        if (description) {
            description = description.toLowerCase();
            if (description.indexOf(search) >= 0)
                return true;
        }

        if (itemInfo.get_executable() == null) {
            log("Missing an executable for " + itemInfo.get_name());
        } else {
            let exec = itemInfo.get_executable().toLowerCase();
            if (exec.indexOf(search) >= 0)
                return true;
        }

        // we expect this._categories.hasOwnProperty(itemInfo.get_id()) to
        // always be true here     
        let categories = this._categories[itemInfo.get_id()]; 
        for (let i = 0; i < categories.length; i++) {
            let category = categories[i].toLowerCase();
            if (category.indexOf(search) >= 0)
                return true;
        }
       
        return false;
    },

    // ==== {{{AppDisplay._createDisplayItem(itemInfo)}}} ====
    //
    // Creates an {{{AppDisplayItem}}} based on {{{itemInfo}}}, which is
    // expected to be a {{{GAppInfo}}} object.

    _createDisplayItem: function(itemInfo) {
        return new AppDisplayItem(itemInfo, this._columnWidth);
    } 
};

Signals.addSignalMethods(AppDisplay.prototype);

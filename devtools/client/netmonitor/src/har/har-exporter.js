/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const DevToolsUtils = require("resource://devtools/shared/DevToolsUtils.js");
const clipboardHelper = require("resource://devtools/shared/platform/clipboard.js");
const {
  HarUtils,
} = require("resource://devtools/client/netmonitor/src/har/har-utils.js");
const {
  HarBuilder,
} = require("resource://devtools/client/netmonitor/src/har/har-builder.js");

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

var uid = 1;

// Helper tracer. Should be generic sharable by other modules (bug 1171927)
const trace = {
  log() {},
};

/**
 * This object represents the main public API designed to access
 * Network export logic. Clients, such as the Network panel itself,
 * should use this API to export collected HTTP data from the panel.
 */
const HarExporter = {
  // Public API

  /**
   * Save collected HTTP data from the Network panel into HAR file.
   *
   * @param Object options
   *        Configuration object
   *
   * The following options are supported:
   *
   * - includeResponseBodies {Boolean}: If set to true, HTTP response bodies
   *   are also included in the HAR file (can produce significantly bigger
   *   amount of data).
   *
   * - items {Array}: List of Network requests to be exported.
   *
   * - jsonp {Boolean}: If set to true the export format is HARP (support
   *   for JSONP syntax).
   *
   * - jsonpCallback {String}: Default name of JSONP callback (used for
   *   HARP format).
   *
   * - compress {Boolean}: If set to true the final HAR file is zipped.
   *   This represents great disk-space optimization.
   *
   * - defaultFileName {String}: Default name of the target HAR file.
   *   The default file name supports the format specifier %date to output the
   *   current date/time.
   *
   * - defaultLogDir {String}: Default log directory for automated logs.
   *
   * - id {String}: ID of the page (used in the HAR file).
   *
   * - title {String}: Title of the page (used in the HAR file).
   *
   * - forceExport {Boolean}: The result HAR file is created even if
   *   there are no HTTP entries.
   *
   * - isSingleRequest {Boolean}: Set to true if only a single request.
   */
  async save(options) {
    // Set default options related to save operation.
    const defaultFileName = Services.prefs.getCharPref(
      "devtools.netmonitor.har.defaultFileName"
    );
    const compress = Services.prefs.getBoolPref(
      "devtools.netmonitor.har.compress"
    );

    trace.log("HarExporter.save; " + defaultFileName, options);

    let data = await this.fetchHarData(options);

    const host = new URL(options.connector.currentTarget.url);

    if (typeof options.isSingleRequest != "boolean") {
      options.isSingleRequest = false;
    }

    const fileName = HarUtils.getHarFileName(
      defaultFileName,
      options.jsonp,
      compress,
      host.hostname,
      options.isSingleRequest && options.items.length
        ? new URL(options.items[0].url).pathname
        : ""
    );

    data = new TextEncoder().encode(data);

    if (compress) {
      const file = await DevToolsUtils.showSaveFileDialog(window, fileName, [
        "*.zip",
      ]);
      this._zip(file, fileName.replace(/\.zip$/, ""), data.buffer);
    } else {
      DevToolsUtils.saveAs(window, data, fileName);
    }
  },

  /**
   * Helper to save the har file into a .zip file
   *
   * @param {nsIFIle} file The final zip file
   * @param {String} fileName Name of the har file within the zip file
   * @param {ArrayBuffer} buffer Content of the har file
   */
  _zip(file, fileName, buffer) {
    const ZipWriter = Components.Constructor(
      "@mozilla.org/zipwriter;1",
      "nsIZipWriter"
    );
    const zipW = new ZipWriter();

    file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, lazy.FileUtils.PERMS_FILE);

    // Open the file in write mode only and reset the size of any existing file
    const MODE_WRONLY = 0x02;
    const MODE_TRUNCATE = 0x20;
    zipW.open(file, MODE_WRONLY | MODE_TRUNCATE);

    const stream = Cc[
      "@mozilla.org/io/arraybuffer-input-stream;1"
    ].createInstance(Ci.nsIArrayBufferInputStream);
    stream.setData(buffer, 0, buffer.byteLength);

    // Needs to be in microseconds for some reason.
    const time = Date.now() * 1000;
    zipW.addEntryStream(fileName, time, 0, stream, false);
    zipW.close();
  },

  /**
   * Copy HAR string into the clipboard.
   *
   * @param Object options
   *        Configuration object, see save() for detailed description.
   */
  copy(options) {
    return this.fetchHarData(options).then(jsonString => {
      clipboardHelper.copyString(jsonString);
      return jsonString;
    });
  },

  /**
   * Get HAR data as JSON object.
   *
   * @param Object options
   *        Configuration object, see save() for detailed description.
   */
  getHar(options) {
    return this.fetchHarData(options).then(data => {
      return data ? JSON.parse(data) : null;
    });
  },

  // Helpers

  fetchHarData(options) {
    // Generate page ID
    options.id = options.id || uid++;

    // Set default generic HAR export options.
    if (typeof options.jsonp != "boolean") {
      options.jsonp = Services.prefs.getBoolPref(
        "devtools.netmonitor.har.jsonp"
      );
    }
    if (typeof options.includeResponseBodies != "boolean") {
      options.includeResponseBodies = Services.prefs.getBoolPref(
        "devtools.netmonitor.har.includeResponseBodies"
      );
    }
    if (typeof options.jsonpCallback != "boolean") {
      options.jsonpCallback = Services.prefs.getCharPref(
        "devtools.netmonitor.har.jsonpCallback"
      );
    }
    if (typeof options.forceExport != "boolean") {
      options.forceExport = Services.prefs.getBoolPref(
        "devtools.netmonitor.har.forceExport"
      );
    }
    if (typeof options.supportsMultiplePages != "boolean") {
      options.supportsMultiplePages = Services.prefs.getBoolPref(
        "devtools.netmonitor.har.multiple-pages"
      );
    }

    // Build HAR object.
    return this.buildHarData(options)
      .then(har => {
        // Do not export an empty HAR file, unless the user
        // explicitly says so (using the forceExport option).
        if (!har.log.entries.length && !options.forceExport) {
          return Promise.resolve();
        }

        let jsonString = this.stringify(har);
        if (!jsonString) {
          return Promise.resolve();
        }

        // If JSONP is wanted, wrap the string in a function call
        if (options.jsonp) {
          // This callback name is also used in HAR Viewer by default.
          // http://www.softwareishard.com/har/viewer/
          const callbackName = options.jsonpCallback || "onInputData";
          jsonString = callbackName + "(" + jsonString + ");";
        }

        return jsonString;
      })
      .catch(function onError(err) {
        console.error(err);
      });
  },

  /**
   * Build HAR data object. This object contains all HTTP data
   * collected by the Network panel. The process is asynchronous
   * since it can involve additional RDP communication (e.g. resolving
   * long strings).
   */
  async buildHarData(options) {
    // Disconnect from redux actions/store.
    options.connector.enableActions(false);

    // Build HAR object from collected data.
    const builder = new HarBuilder(options);
    const result = await builder.build();

    // Connect to redux actions again.
    options.connector.enableActions(true);

    return result;
  },

  /**
   * Build JSON string from the HAR data object.
   */
  stringify(har) {
    if (!har) {
      return null;
    }

    try {
      return JSON.stringify(har, null, "  ");
    } catch (err) {
      console.error(err);
      return undefined;
    }
  },
};

// Exports from this module
exports.HarExporter = HarExporter;

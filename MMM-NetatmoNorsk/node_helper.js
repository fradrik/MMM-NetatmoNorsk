/* MagicMirror² module: MMM-NetatmoNorsk
 * Henter data fra Netatmo værstasjon og sender en forenklet struktur til frontend.
 * MIT License
 */
const NodeHelper = require("node_helper");
let Log;
try { Log = require("logger"); } catch (e) { Log = console; } // eldre MagicMirror har ikke logger
const netatmo = require("./netatmo_api.js");

module.exports = NodeHelper.create({
  start () {
    this.config = null;
    this.timer = null;
    this.lastPayload = null;
    this.running = false;
  },

  socketNotificationReceived (notification, payload) {
    if (notification !== "NETATMONO_INIT") return;

    // Flere nettleservinduer / omstart av frontend: ikke start en ny løkke,
    // bare send siste data på nytt. (To parallelle løkker kan ødelegge refresh-tokenet.)
    if (this.running) {
      if (this.lastPayload) this.sendSocketNotification("NETATMONO_DATA", this.lastPayload);
      return;
    }

    this.config = payload;
    const missing = ["clientId", "clientSecret", "refreshToken"].filter((k) => !payload.mockData && !payload[k]);
    if (missing.length && !netatmo.hasStoredToken(__dirname)) {
      this.sendError(`Mangler i config: ${missing.join(", ")}`);
      return;
    }

    this.running = true;
    this.loop();
  },

  async loop () {
    clearTimeout(this.timer);
    let delayMs = this.config.updateInterval * 60 * 1000;

    try {
      const raw = this.config.mockData
        ? netatmo.mockData(__dirname)
        : await netatmo.getStationsData(__dirname, this.config);

      this.lastPayload = { status: "OK", stations: netatmo.normalize(raw), fetchedAt: Date.now() };
      this.sendSocketNotification("NETATMONO_DATA", this.lastPayload);
    } catch (err) {
      Log.error(err.message);
      this.sendError(err.message, err.fatal);
      if (err.fatal) {
        // Refresh-token er ugyldig; ingen vits å hamre på API-et. Prøv igjen om 30 min
        // i tilfelle brukeren har lagt inn nytt token i config og startet på nytt.
        delayMs = 30 * 60 * 1000;
      } else {
        delayMs = Math.min(delayMs, 60 * 1000); // nettverksfeil: prøv igjen om 1 min
      }
    }

    this.timer = setTimeout(() => this.loop(), delayMs);
  },

  sendError (message, fatal = false) {
    this.sendSocketNotification("NETATMONO_DATA", {
      status: "ERROR",
      message,
      fatal,
      // behold gamle data på skjermen hvis vi har dem
      stations: this.lastPayload ? this.lastPayload.stations : null,
      fetchedAt: this.lastPayload ? this.lastPayload.fetchedAt : null
    });
  }
});

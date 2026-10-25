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
    this.rainCache = {}; // modul-id -> { at, rainDay, rainWeek }
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

      const stations = netatmo.normalize(raw);
      if (this.config.rainHistory) await this.addRainHistory(stations);
      this.lastPayload = { status: "OK", stations, fetchedAt: Date.now() };
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

  // Regnhistorikk hentes sjeldnere (standard hvert 30. min) for å spare API-kall.
  // Feil her skal aldri stoppe resten av modulen.
  async addRainHistory (stations) {
    const maxAge = this.config.rainHistoryInterval * 60 * 1000;
    for (const st of stations) {
      for (const m of st.modules) {
        if (m.kind !== "rain" || !m.reachable) continue;
        const key = m.id || "mock";
        let c = this.rainCache[key];
        if (!c || Date.now() - c.at > maxAge) {
          try {
            const h = this.config.mockData
              ? netatmo.mockRainHistory()
              : await netatmo.getRainHistory(__dirname, this.config, st.id, m.id);
            c = this.rainCache[key] = { at: Date.now(), rainDay: h.rainDay, rainWeek: h.rainWeek };
          } catch (err) {
            Log.warn(`Regnhistorikk: ${err.message}`);
          }
        }
        if (c) { m.rainDay = c.rainDay; m.rainWeek = c.rainWeek; }
      }
    }
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

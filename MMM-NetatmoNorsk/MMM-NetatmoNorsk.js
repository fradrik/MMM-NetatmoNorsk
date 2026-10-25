/* MagicMirror² module: MMM-NetatmoNorsk
 * Viser inne/ute, CO2, støy, trykk og regn fra Netatmo værstasjon.
 * MIT License
 */
/* global Module, Log */
Module.register("MMM-NetatmoNorsk", {
  defaults: {
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    deviceId: "", // valgfritt: MAC-adressen til hovedstasjonen hvis du har flere
    updateInterval: 5, // minutter. Netatmo oppdaterer selv ca. hvert 10. minutt
    mockData: false, // true = testdata, ingen Netatmo-konto nødvendig
    show: ["outdoor", "main", "indoor", "rain"], // rekkefølge, fjern det du ikke vil se
    showMinMax: true,
    showTrend: true,
    showBattery: true, // varsler bare når batteriet er lavt
    lowBatteryPercent: 20,
    co2Warning: 1000,
    co2Alert: 1500,
    staleMinutes: 30, // marker data som gamle etter så mange minutter
    showUpdated: true
  },

  getStyles () {
    return ["MMM-NetatmoNorsk.css", "font-awesome.css"];
  },

  start () {
    this.data_ = null;
    this.sendSocketNotification("NETATMONO_INIT", this.config);
    // Oppdater "x min siden"-teksten hvert minutt uten nytt API-kall
    setInterval(() => this.updateDom(), 60 * 1000);
  },

  socketNotificationReceived (notification, payload) {
    if (notification !== "NETATMONO_DATA") return;
    this.data_ = payload;
    this.updateDom(this.data_ && this.data_.status === "OK" ? 500 : 0);
  },

  getDom () {
    const root = el("div", "netatmo-no");
    const p = this.data_;

    if (!p) {
      root.appendChild(el("div", "dimmed light small", "Henter Netatmo-data …"));
      return root;
    }

    if (p.status === "ERROR") {
      root.appendChild(el("div", "nn-error xsmall", `Netatmo: ${p.message}`));
      if (!p.stations) return root;
    }

    p.stations.forEach((st) => {
      const wrap = el("div", "nn-station");
      const all = [st.main, ...st.modules];

      this.config.show.forEach((kind) => {
        all.filter((m) => m.kind === kind).forEach((m) => {
          const block = this.renderModule(m);
          if (block) wrap.appendChild(block);
        });
      });
      root.appendChild(wrap);
    });

    if (this.config.showUpdated && p.fetchedAt) {
      const mods = p.stations.reduce((acc, s) => acc.concat([s.main], s.modules), []);
      const newest = Math.max.apply(null, mods.map((m) => m.time || 0));
      const ts = newest || p.fetchedAt;
      const mins = Math.round((Date.now() - ts) / 60000);
      const stale = mins >= this.config.staleMinutes;
      root.appendChild(el("div", `nn-updated xsmall ${stale ? "nn-stale" : "dimmed"}`,
        mins < 1 ? "Målt nå nettopp" : `Målt for ${mins} min siden`));
    }

    return root;
  },

  renderModule (m) {
    const titles = { main: "Inne", indoor: m.name || "Inne", outdoor: "Ute", rain: "Regn", wind: "Vind" };
    const block = el("div", `nn-block nn-${m.kind}`);
    const head = el("div", "nn-title xsmall dimmed", m.kind === "indoor" ? m.name : titles[m.kind]);
    if (this.config.showBattery && m.battery !== null && m.battery <= this.config.lowBatteryPercent) {
      head.appendChild(el("span", "nn-battery", ` · lavt batteri (${m.battery} %)`));
    }
    block.appendChild(head);

    if (!m.reachable) {
      block.appendChild(el("div", "small dimmed", "Ikke tilgjengelig"));
      return block;
    }

    if (m.kind === "rain") {
      block.appendChild(el("div", "nn-big medium bright", `${fmt(m.rain24h, 1)} mm`));
      // sum_rain_24 = døgnsum fra Netatmo, sum_rain_1 = siste time
      block.appendChild(this.row([["siste time", `${fmt(m.rain1h, 1)} mm`]]));
      return block;
    }

    if (m.kind === "wind") {
      block.appendChild(el("div", "nn-big medium bright", `${fmt(m.wind, 0)} km/t`));
      block.appendChild(this.row([["kast", `${fmt(m.gust, 0)} km/t`]]));
      return block;
    }

    if (m.temperature !== null) {
      const big = el("div", "nn-big medium bright", `${fmt(m.temperature, 1)}°`);
      if (this.config.showTrend && m.tempTrend) big.appendChild(trendIcon(m.tempTrend));
      block.appendChild(big);
    }

    const rows = [];
    if (this.config.showMinMax && m.minTemp !== null && m.maxTemp !== null) {
      rows.push(["min/maks", `${fmt(m.minTemp, 1)}° / ${fmt(m.maxTemp, 1)}°`]);
    }
    if (m.humidity !== null) rows.push(["fukt", `${m.humidity} %`]);
    if (m.co2 !== null) rows.push(["CO₂", `${m.co2} ppm`, this.co2Class(m.co2)]);
    if (m.noise !== null) rows.push(["støy", `${m.noise} dB`]);
    if (m.pressure !== null) {
      rows.push(["trykk", `${fmt(m.pressure, 0)} hPa`, "", this.config.showTrend ? m.pressureTrend : null]);
    }
    block.appendChild(this.row(rows));
    return block;
  },

  row (rows) {
    const t = el("table", "nn-table xsmall");
    rows.forEach(([label, value, cls, trend]) => {
      const tr = el("tr");
      tr.appendChild(el("td", "nn-label dimmed", label));
      const td = el("td", `nn-value ${cls || ""}`, value);
      if (trend) td.appendChild(trendIcon(trend));
      tr.appendChild(td);
      t.appendChild(tr);
    });
    return t;
  },

  co2Class (v) {
    if (v >= this.config.co2Alert) return "nn-bad";
    if (v >= this.config.co2Warning) return "nn-warn";
    return "nn-good";
  }
});

function el (tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmt (v, decimals) {
  if (v === null || v === undefined) return "–";
  return v.toFixed(decimals).replace(".", ",");
}

function trendIcon (trend) {
  const map = { up: "fa-arrow-up", down: "fa-arrow-down", stable: "fa-arrow-right" };
  return el("i", `fa ${map[trend] || "fa-arrow-right"} nn-trend`);
}

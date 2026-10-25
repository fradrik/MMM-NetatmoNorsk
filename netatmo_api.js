/* Netatmo API-klient for MMM-NetatmoNorsk.
 * Ingen avhengigheter til MagicMirror, så den kan testes fra kommandolinja (se test_auth.js).
 * Virker på Node 10 og nyere (bruker innebygd https-modul, ikke fetch).
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL, URLSearchParams } = require("url");

const API = process.env.NETATMO_API || "https://api.netatmo.com"; // env kun for testing

/* Enkel HTTP-klient som gir samme svar-form som vi trenger fra fetch */
function request (method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "http:" ? http : https;
    const opts = { method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers: Object.assign({}, headers) };
    if (body) opts.headers["Content-Length"] = Buffer.byteLength(body);
    const req = lib.request(opts, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let json = {};
        try { json = JSON.parse(data); } catch (e) { json = {}; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, statusText: res.statusMessage, json });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error("tidsavbrudd etter 20 s")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
const TOKEN_FILE = "token.json";

class NetatmoError extends Error {
  constructor (message, fatal = false) {
    super(message);
    this.fatal = fatal;
  }
}

/* ---------- Token-lagring ---------- */

function tokenPath (dir) {
  return path.join(dir, TOKEN_FILE);
}

function readStore (dir) {
  try {
    return JSON.parse(fs.readFileSync(tokenPath(dir), "utf8"));
  } catch (e) {
    return null;
  }
}

function writeStore (dir, store) {
  // Skriv til temp-fil og rename, så en strømbrudd midt i skrivingen ikke gir en tom token.json
  const tmp = `${tokenPath(dir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, tokenPath(dir));
}

function hasStoredToken (dir) {
  const s = readStore(dir);
  return Boolean(s && s.refresh_token);
}

/**
 * Netatmo roterer refresh-tokenet ved hver fornyelse. Det gamle slutter da å virke.
 * Derfor lagrer vi det nyeste i token.json. Hvis brukeren limer inn et NYTT token i config
 * (f.eks. etter en feil), skal det vinne over token.json.
 */
function currentRefreshToken (dir, config) {
  const store = readStore(dir);
  if (store && store.refresh_token && store.config_refresh_token === config.refreshToken) {
    return store.refresh_token;
  }
  if (config.refreshToken) return config.refreshToken;
  if (store && store.refresh_token) return store.refresh_token;
  return null;
}

/* ---------- OAuth ---------- */

async function refreshAccessToken (dir, config) {
  const refreshToken = currentRefreshToken(dir, config);
  if (!refreshToken) throw new NetatmoError("Fant ikke refresh-token (verken i config eller token.json).", true);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret
  }).toString();

  let res;
  try {
    res = await request("POST", `${API}/oauth2/token`,
      { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body);
  } catch (e) {
    throw new NetatmoError(`Nettverksfeil mot Netatmo (token): ${e.message}`);
  }

  const json = res.json;

  if (!res.ok || json.error) {
    const code = json.error || res.status;
    if (code === "invalid_grant") {
      throw new NetatmoError(
        "Refresh-tokenet er ugyldig eller utløpt. Lag et nytt i dev.netatmo.com (Token generator, scope read_station) og lim det inn som refreshToken i config.",
        true
      );
    }
    if (code === "invalid_client") {
      throw new NetatmoError("clientId eller clientSecret er feil.", true);
    }
    throw new NetatmoError(`Token-feil fra Netatmo: ${code} ${json.error_description || ""}`.trim());
  }

  const store = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || refreshToken,
    expires_at: Date.now() + (json.expires_in || 10800) * 1000,
    config_refresh_token: config.refreshToken || null,
    updated: new Date().toISOString()
  };
  writeStore(dir, store);
  return store.access_token;
}

async function getAccessToken (dir, config, force = false) {
  const store = readStore(dir);
  const fresh = store && store.access_token && store.expires_at - Date.now() > 5 * 60 * 1000 &&
    store.config_refresh_token === (config.refreshToken || null);
  if (fresh && !force) return store.access_token;
  return refreshAccessToken(dir, config);
}

/* ---------- Data ---------- */

async function getStationsData (dir, config, retried = false) {
  const token = await getAccessToken(dir, config, retried);
  const url = new URL(`${API}/api/getstationsdata`);
  if (config.deviceId) url.searchParams.set("device_id", config.deviceId);

  let res;
  try {
    res = await request("GET", url.toString(), { Authorization: `Bearer ${token}` });
  } catch (e) {
    throw new NetatmoError(`Nettverksfeil mot Netatmo (data): ${e.message}`);
  }

  const json = res.json;

  // Netatmo: kode 2 = ugyldig token, 3 = utløpt token. Forny én gang og prøv igjen.
  const errCode = json.error && json.error.code;
  if ((res.status === 401 || res.status === 403 || errCode === 2 || errCode === 3) && !retried) {
    return getStationsData(dir, config, true);
  }
  if (!res.ok || json.error) {
    const msg = (json.error && json.error.message) || res.statusText;
    throw new NetatmoError(`Datafeil fra Netatmo (${res.status}): ${msg}`);
  }
  return json.body;
}

function mockData (dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "sample.json"), "utf8")).body;
}

/* ---------- Forenkling ---------- */

const TYPE = { NAMain: "main", NAModule1: "outdoor", NAModule4: "indoor", NAModule3: "rain", NAModule2: "wind" };

function pickModule (m) {
  const d = m.dashboard_data || {};
  return {
    id: m._id,
    name: m.module_name || "",
    kind: TYPE[m.type] || "unknown",
    reachable: m.reachable !== false && Boolean(m.dashboard_data),
    battery: typeof m.battery_percent === "number" ? m.battery_percent : null,
    time: d.time_utc ? d.time_utc * 1000 : null,
    temperature: num(d.Temperature),
    tempTrend: d.temp_trend || null,
    minTemp: num(d.min_temp),
    maxTemp: num(d.max_temp),
    humidity: num(d.Humidity),
    co2: num(d.CO2),
    noise: num(d.Noise),
    pressure: num(d.Pressure),
    pressureTrend: d.pressure_trend || null,
    rain: num(d.Rain),
    rain1h: num(d.sum_rain_1),
    rain24h: num(d.sum_rain_24),
    wind: num(d.WindStrength),
    gust: num(d.GustStrength),
    windAngle: num(d.WindAngle)
  };
}

function num (v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function normalize (body) {
  const devices = (body && body.devices) || [];
  return devices.map((dev) => ({
    id: dev._id,
    name: dev.station_name || dev.home_name || "Netatmo",
    main: pickModule(dev),
    modules: (dev.modules || []).map(pickModule)
  }));
}

module.exports = { getStationsData, refreshAccessToken, hasStoredToken, mockData, normalize, NetatmoError };

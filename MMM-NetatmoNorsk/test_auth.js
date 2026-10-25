/* Test Netatmo-tilgang uten å starte MagicMirror:
 *   node test_auth.js CLIENT_ID CLIENT_SECRET REFRESH_TOKEN
 * Skriver token.json (samme som modulen bruker) og viser hva den fant.
 */
const api = require("./netatmo_api.js");
const [clientId, clientSecret, refreshToken] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.log("Bruk: node test_auth.js CLIENT_ID CLIENT_SECRET [REFRESH_TOKEN]");
  process.exit(1);
}
api.getStationsData(__dirname, { clientId, clientSecret, refreshToken })
  .then((body) => {
    for (const st of api.normalize(body)) {
      console.log(`Stasjon: ${st.name} (${st.id})`);
      for (const m of [st.main, ...st.modules]) {
        console.log(`  ${m.kind.padEnd(8)} ${m.name.padEnd(12)} temp=${m.temperature} fukt=${m.humidity} co2=${m.co2} regn24=${m.rain24h} batteri=${m.battery}`);
      }
    }
    console.log("\nOK! token.json er lagret. Modulen bruker denne videre.");
  })
  .catch((e) => { console.error("FEIL:", e.message); process.exit(1); });

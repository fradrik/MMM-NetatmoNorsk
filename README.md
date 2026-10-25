# MMM-NetatmoNorsk

MagicMirror²-modul som viser data fra Netatmo værstasjon på norsk: ute, inne (temperatur, fukt, CO₂, støy, trykk), ekstra innemoduler og regnmåler.

Bygget som erstatning for MMM-Netatmo, med fokus på det som oftest går galt der: refresh-tokenet.

## Hvorfor originalen ofte slutter å virke

Netatmo bytter ut refresh-tokenet hver gang det fornyes (ca. hver 3. time). Det gamle blir da ugyldig. Hvis den nye verdien ikke blir lagret (skrivefeil, to MagicMirror-instanser, strømbrudd midt i skrivingen), står du igjen med et dødt token og får `invalid_grant`.

Denne modulen:

- lagrer nyeste token i `token.json` med atomisk skriving (tåler strømbrudd)
- kjører bare én hente-løkke selv om flere skjermer/nettlesere er koblet til
- fornyer tokenet automatisk og prøver igjen ved 403/utløpt token
- viser en tydelig feilmelding på speilet hvis tokenet er dødt, i stedet for å stå tom
- oppdager når du limer inn et nytt token i config, og bruker det i stedet for det gamle i `token.json`

## Installasjon på Raspberry Pi

Virker på Node 10 og nyere. Ingen npm-avhengigheter.

```bash
cd ~/MagicMirror/modules
# kopier mappa MMM-NetatmoNorsk hit, f.eks. med scp fra Mac:
#   scp -r MMM-NetatmoNorsk pi@<ip-til-pi>:~/MagicMirror/modules/
```

## Netatmo-nøkler

1. Logg inn på https://dev.netatmo.com/apps og lag en app (navn og beskrivelse kan være hva som helst).
2. Noter **client ID** og **client secret**.
3. Under **Token generator** på samme side: velg scope `read_station`, trykk Generate og godkjenn.
4. Kopier **refresh token** (ikke access token).

Test nøklene direkte på Pi-en før du starter speilet:

```bash
cd ~/MagicMirror/modules/MMM-NetatmoNorsk
node test_auth.js DIN_CLIENT_ID DIN_CLIENT_SECRET DITT_REFRESH_TOKEN
```

Får du lista over moduler, er alt i orden og `token.json` er lagret.

## Config

I `~/MagicMirror/config/config.js`:

```js
{
  module: "MMM-NetatmoNorsk",
  position: "top_right",
  header: "Netatmo",
  config: {
    clientId: "DIN_CLIENT_ID",
    clientSecret: "DIN_CLIENT_SECRET",
    refreshToken: "DITT_REFRESH_TOKEN"
  }
},
```

### Valg

| Valg | Standard | Forklaring |
|---|---|---|
| `updateInterval` | `5` | Minutter mellom henting. Netatmo måler selv ca. hvert 10. min. |
| `show` | `["outdoor","main","indoor","rain"]` | Hva som vises og i hvilken rekkefølge. `"wind"` støttes også. |
| `showMinMax` | `true` | Min/maks temperatur i dag |
| `showTrend` | `true` | Piler for temperatur- og trykktrend |
| `showBattery` | `true` | Varsel ved lavt batteri på moduler |
| `lowBatteryPercent` | `20` | Grense for batterivarsel |
| `co2Warning` / `co2Alert` | `1000` / `1500` | CO₂-grenser for gul/rød farge (ppm) |
| `staleMinutes` | `30` | «Målt for X min siden» blir gul etter så lenge |
| `deviceId` | `""` | MAC til hovedstasjonen, kun hvis du har flere stasjoner og vil vise én |
| `mockData` | `false` | `true` viser testdata uten Netatmo-konto |

## Feilsøking

- **«Refresh-tokenet er ugyldig eller utløpt»**: lag nytt token i Token generator, lim inn i config, start MagicMirror på nytt (`pm2 restart MagicMirror`). Modulen merker at config-tokenet er nytt og tar det i bruk.
- **«clientId eller clientSecret er feil»**: sjekk at du har kopiert fra riktig app.
- Logger: `pm2 logs MagicMirror` eller terminalen der MagicMirror kjører.
- Ikke kjør den samme appen/tokenet i to ting samtidig (f.eks. Home Assistant og speilet). Lag heller en egen app per tjeneste i dev.netatmo.com.

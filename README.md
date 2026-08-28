# Kedy zapínať spotrebiče

Mobilná webová appka (jeden `index.html`), ktorá na časovej osi ukazuje, kedy je
výhodné/nevýhodné zapínať veľké spotrebiče (podľa sadzby VT/NT a slnečného okna),
a k tomu zobrazuje aktuálnu výrobu fotovoltiky.

## Živá výroba fotovoltiky

Karta v hornej časti appky ukazuje aktuálny výkon (kW) a dnešný výnos (kWh) z
Huawei FusionSolar kiosku. Keďže kiosk endpoint nepodporuje CORS (nedá sa volať
priamo z prehliadača na inej doméne), dáta sťahuje naplánovaný GitHub Actions
workflow [`fetch-pv.yml`](.github/workflows/fetch-pv.yml) každých 5 minút a
ukladá ich do [`data/pv.json`](data/pv.json), ktorý appka číta.

- Skript: [`scripts/fetch-pv.js`](scripts/fetch-pv.js)
- Zdroj dát: verejný kiosk link FusionSolar (bez prihlásenia)

## Predpoveď výroby

Predpoveď na zvyšok dňa a na zajtra počíta samostatný workflow
[`fetch-forecast.yml`](.github/workflows/fetch-forecast.yml) raz za hodinu (nie
5 minút ako pri live výkone — podkladové meteo dáta z Open-Meteo sa tak často
nemenia) a ukladá ju do [`data/forecast.json`](data/forecast.json).

- Skript: [`scripts/forecast.js`](scripts/forecast.js)
- Zdroj dát: Open-Meteo (žiarenie, teplota, oblačnosť)

Oba skripty pri dočasnom výpadku siete skúsia fetch zopakovať (viď
[`scripts/http.js`](scripts/http.js)), aby jeden prechodný chybný request
nezhodil celý beh workflow.

Ak repozitár 60 dní nemá žiadny commit, GitHub automaticky pozastaví
naplánované workflowy — stačí spustiť príslušný workflow ručne (tab *Actions* →
*Fetch PV production data* alebo *Compute solar forecast* → *Run workflow*) a
beh pokračuje ďalej.

## Nasadenie (GitHub Pages)

V nastaveniach repozitára **Settings → Pages** nastav *Source: Deploy from a
branch*, branch `main`, priečinok `/ (root)`. Appka je statická, netreba
žiadny build krok.

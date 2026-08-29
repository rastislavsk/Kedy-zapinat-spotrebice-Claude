# pv-proxy (Cloudflare Worker)

CORS proxy pre Huawei FusionSolar kiosk endpoint (appka ho volá priamo z prehliadača
pre živý výkon fotovoltiky) + cron trigger, ktorý každých 5 minút spúšťa GitHub Actions
workflow [`fetch-pv.yml`](../.github/workflows/fetch-pv.yml) a
[`fetch-forecast.yml`](../.github/workflows/fetch-forecast.yml) cez `workflow_dispatch`.

Dôvod cronu vo Workeri: natívny `schedule` cron v GitHub Actions je nespoľahlivý
(reálne beží raz za hodiny, nie tak často ako je nastavené). Cloudflare Cron Triggers
sú spoľahlivejšie, tak spúšťajú oba GH Actions workflow namiesto GH plánovača.

## Nasadenie (jednorazovo)

1. **Pripoj Git integráciu**: Cloudflare dashboard → Workers & Pages → `pv-proxy` →
   Settings → Build → Connect to Git → vyber tento repozitár, root directory `worker/`.
   Odvtedy sa každý push do `main` s zmenou v `worker/` automaticky nasadí.
2. **Nastav secret**: Settings → Variables and Secrets → Add:
   - Name: `GH_DISPATCH_TOKEN`
   - Value: fine-grained GitHub PAT (len tento repozitár, `Actions: Read and write`)
   - Type: Secret (encrypted)
3. Cron trigger (`*/5 * * * *`) je definovaný v [`wrangler.toml`](wrangler.toml) —
   Git-connected deploy ho nastaví automaticky, netreba nič klikať navyše.

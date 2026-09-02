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

## Troubleshooting: červený check "Workers Builds: pv-proxy" na PR

**Potvrdená príčina (overené diagnostickým `pwd && ls -la` priamo v builde):**
Nastavenie **Root directory** (`worker`) v Cloudflare dashboarde ovplyvňuje working
directory len pre **Build command**. Pre **Version command** (non-production branch —
teda presne PR buildy) sa napriek tomu spúšťa z koreňa repozitára
(`/opt/buildhome/repo`), kde `wrangler.toml` nie je — preto `npx wrangler versions
upload` padal na "Missing entry-point to Worker script", aj keď produkčný `wrangler
deploy` na `main` fungoval spoľahlivo.

Fix: Cloudflare dashboard → Workers & Pages → `pv-proxy` → Settings → Build →
Build configuration → **Version command** nastav na:

```
npx wrangler versions upload --config worker/wrangler.toml
```

(`--config` je cesta relatívna ku koreňu repozitára, nie k Root directory.) Pre
istotu je vhodné rovnaký `--config` flag pridať aj do **Deploy command**
(`npx wrangler deploy --config worker/wrangler.toml`), aj keď produkčný build
bez neho fungoval.

Vedľajšia zmena: `worker/package.json` pinuje verziu `wrangler` — nebola to
príčina tohto konkrétneho zlyhania, ale je to dobrá prax, nech je verzia
Wranglera medzi buildmi konzistentná.

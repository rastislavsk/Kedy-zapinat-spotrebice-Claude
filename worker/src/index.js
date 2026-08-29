export default {
  async fetch() {
    const KIOSK_URL = 'https://uni004eu5.fusionsolar.huawei.com/rest/pvms/web/kiosk/v1/station-kiosk-file?kk=fNpkjQuEAOvn4Cn8hdu9k2GvPD9oPMuq';
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };

    try {
      const res = await fetch(KIOSK_URL);
      if (!res.ok) throw new Error('kiosk HTTP ' + res.status);
      const outer = await res.json();
      const decoded = outer.data
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'");
      const inner = JSON.parse(decoded);
      const kpi = inner.realKpi || {};

      const realCurveToday = [];
      const curve = inner.powerCurve;
      if (curve && Array.isArray(curve.xAxis) && Array.isArray(curve.activePower)) {
        for (let i = 0; i < curve.xAxis.length; i++) {
          const raw = curve.activePower[i];
          if (raw === undefined || raw === null || raw === '-') continue;
          const kw = Number(raw);
          if (!Number.isFinite(kw)) continue;
          const [hh, mm] = String(curve.xAxis[i]).split(':').map(Number);
          if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
          realCurveToday.push({ hour: Number((hh + mm / 60).toFixed(4)), kw });
        }
      }

      const output = {
        realTimePowerKw: typeof kpi.realTimePower === 'number' ? kpi.realTimePower : null,
        dailyEnergyKwh: typeof kpi.dailyEnergy === 'number' ? kpi.dailyEnergy : null,
        monthEnergyKwh: typeof kpi.monthEnergy === 'number' ? kpi.monthEnergy : null,
        yearEnergyKwh: typeof kpi.yearEnergy === 'number' ? kpi.yearEnergy : null,
        cumulativeEnergyKwh: typeof kpi.cumulativeEnergy === 'number' ? kpi.cumulativeEnergy : null,
        stationName: inner.stationOverview ? inner.stationOverview.stationName : null,
        realCurveToday,
        updatedAt: new Date().toISOString(),
      };

      return new Response(JSON.stringify(output), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers: corsHeaders });
    }
  },

  // Cron trigger: spustí fetch-pv.yml na GitHube, lebo natívny GH Actions
  // `schedule` cron beží pri 5-min. intervale nespoľahlivo (reálne raz za hodiny),
  // preto oba GH Actions workflow spúšťame priamo cez workflow_dispatch odtiaľto.
  async scheduled(event, env, ctx) {
    const workflows = ['fetch-pv.yml', 'fetch-forecast.yml'];
    for (const workflow of workflows) {
      const resp = await fetch(
        `https://api.github.com/repos/rastislavsk/Kedy-zapinat-spotrebice-Claude/actions/workflows/${workflow}/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.GH_DISPATCH_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'pv-proxy-cron',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main' }),
        }
      );
      if (!resp.ok) {
        console.log('workflow_dispatch failed', workflow, resp.status, await resp.text());
      }
    }
  },
};

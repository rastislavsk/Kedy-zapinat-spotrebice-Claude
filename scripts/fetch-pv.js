const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./http');

const KIOSK_URL = process.env.KIOSK_URL;

function decodeEntities(str) {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'");
}

// Dnešná skutočná výroba priamo z kiosku (5-min kroky), len hodnoty do teraz.
function extractRealCurveToday(powerCurve) {
    if (!powerCurve || !Array.isArray(powerCurve.xAxis) || !Array.isArray(powerCurve.activePower)) return [];
    const points = [];
    for (let i = 0; i < powerCurve.xAxis.length; i++) {
        const raw = powerCurve.activePower[i];
        if (raw === undefined || raw === null || raw === '-') continue;
        const kw = Number(raw);
        if (!Number.isFinite(kw)) continue;
        const [hh, mm] = String(powerCurve.xAxis[i]).split(':').map(Number);
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
        points.push({ hour: Number((hh + mm / 60).toFixed(4)), kw });
    }
    return points;
}

async function main() {
    if (!KIOSK_URL) {
        throw new Error('KIOSK_URL env var is not set');
    }

    const res = await fetchWithRetry(KIOSK_URL);
    const outer = await res.json();
    const inner = JSON.parse(decodeEntities(outer.data));
    const kpi = inner.realKpi || {};

    const output = {
        realTimePowerKw: typeof kpi.realTimePower === 'number' ? kpi.realTimePower : null,
        dailyEnergyKwh: typeof kpi.dailyEnergy === 'number' ? kpi.dailyEnergy : null,
        monthEnergyKwh: typeof kpi.monthEnergy === 'number' ? kpi.monthEnergy : null,
        yearEnergyKwh: typeof kpi.yearEnergy === 'number' ? kpi.yearEnergy : null,
        cumulativeEnergyKwh: typeof kpi.cumulativeEnergy === 'number' ? kpi.cumulativeEnergy : null,
        stationName: inner.stationOverview ? inner.stationOverview.stationName : null,
        realCurveToday: extractRealCurveToday(inner.powerCurve),
        updatedAt: new Date().toISOString(),
    };

    const outDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'pv.json'), JSON.stringify(output, null, 2) + '\n');

    console.log('Saved data/pv.json:', { ...output, realCurveToday: `${output.realCurveToday.length} bodov` });
}

main().catch((err) => {
    console.error('Failed to fetch PV data:', err);
    process.exit(1);
});

const fs = require('fs');
const path = require('path');

const KIOSK_URL = process.env.KIOSK_URL;

function decodeEntities(str) {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'");
}

async function main() {
    if (!KIOSK_URL) {
        throw new Error('KIOSK_URL env var is not set');
    }

    const res = await fetch(KIOSK_URL);
    if (!res.ok) {
        throw new Error(`Kiosk request failed with status ${res.status}`);
    }

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
        updatedAt: new Date().toISOString(),
    };

    const outDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'pv.json'), JSON.stringify(output, null, 2) + '\n');

    console.log('Saved data/pv.json:', output);
}

main().catch((err) => {
    console.error('Failed to fetch PV data:', err);
    process.exit(1);
});

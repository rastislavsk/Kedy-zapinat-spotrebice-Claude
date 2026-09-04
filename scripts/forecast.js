// Predpoveď výroby FV pre Dvorany nad Nitrou.
// Open-Meteo dáva žiarenie (GHI/DNI/DHI) a teplotu, tento skript si sám
// dopočíta polohu slnka a premietne žiarenie na roviny panelov (juh + východ),
// rovnakým princípom ako SolarCast.

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./http');

const LAT = 48.4800;
const LON = 18.1200;
const TIMEZONE = 'Europe/Bratislava';

const STRINGS = [
    { panels: 16, azimuthDeg: 180, tiltDeg: 40 }, // juh
    { panels: 8, azimuthDeg: 90, tiltDeg: 40 },   // vychod
];
const PANEL_WP = 435;
const AC_LIMIT_KW = 10;
const SYSTEM_EFFICIENCY = 0.88;
const TEMP_COEF_PCT_PER_C = -0.41;
const NOCT_C = 45; // typicka nominalna prevadzkova teplota clanku, panel nespresnil
const ALBEDO = 0.2;

const HIGH_KW = 4;               // hranica "vysoka vyroba" v texte appky
const STRONGER_WINDOW_MARGIN_KW = 1.5; // o kolko musi byt buduce okno lepsie nez teraz

const ELEV_M = 180; // priblizna nadmorska vyska Dvorian nad Nitrou
// Bezoblacny strop (rovnaky Meinelov model s Laueho vyskovou korekciou ako v SolarCaste):
// horna hranica vyroby, keby bola obloha cely den cista.
const CS_TAU = 0.80;
const CS_DHI_FRAC = 0.12;

function toRad(deg) { return (deg * Math.PI) / 180; }
function toDeg(rad) { return (rad * 180) / Math.PI; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Zjednodusený NOAA vypocet polohy slnka, pocitane priamo v UTC
// (dlzka sa premieta priamo do rovnice casu, netreba riesit civilne pasmo).
function solarPosition(dateUtc, latDeg, lonDeg) {
    const startOfYear = Date.UTC(dateUtc.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((dateUtc.getTime() - startOfYear) / 86400000) + 1;
    const hourUtc = dateUtc.getUTCHours() + dateUtc.getUTCMinutes() / 60;

    const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourUtc - 12) / 24);

    const eqTimeMin = 229.18 * (
        0.000075
        + 0.001868 * Math.cos(gamma)
        - 0.032077 * Math.sin(gamma)
        - 0.014615 * Math.cos(2 * gamma)
        - 0.040849 * Math.sin(2 * gamma)
    );

    const declRad = 0.006918
        - 0.399912 * Math.cos(gamma)
        + 0.070257 * Math.sin(gamma)
        - 0.006758 * Math.cos(2 * gamma)
        + 0.000907 * Math.sin(2 * gamma)
        - 0.002697 * Math.cos(3 * gamma)
        + 0.00148 * Math.sin(3 * gamma);

    const timeOffsetMin = eqTimeMin + 4 * lonDeg;
    const trueSolarTimeMin = hourUtc * 60 + timeOffsetMin;
    const hourAngleDeg = trueSolarTimeMin / 4 - 180;

    const latRad = toRad(latDeg);
    const hourAngleRad = toRad(hourAngleDeg);

    const sinElevation = Math.sin(latRad) * Math.sin(declRad)
        + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
    const elevationRad = Math.asin(clamp(sinElevation, -1, 1));
    const elevationDeg = toDeg(elevationRad);

    let azimuthDeg = 180;
    if (elevationDeg > 0) {
        const cosAzimuth = (Math.sin(declRad) - Math.sin(elevationRad) * Math.sin(latRad))
            / (Math.cos(elevationRad) * Math.cos(latRad));
        const azRad = Math.acos(clamp(cosAzimuth, -1, 1));
        azimuthDeg = hourAngleDeg > 0 ? 360 - toDeg(azRad) : toDeg(azRad);
    }

    return { elevationDeg, azimuthDeg };
}

// Ziarenie na naklonenej rovine panelu (izotropny model oblohy).
function poaIrradiance(ghi, dni, dhi, elevationDeg, azimuthDeg, tiltDeg, panelAzimuthDeg) {
    if (elevationDeg <= 0) return 0;

    const elevationRad = toRad(elevationDeg);
    const tiltRad = toRad(tiltDeg);
    const azDiffRad = toRad(azimuthDeg - panelAzimuthDeg);

    const cosAoi = Math.sin(elevationRad) * Math.cos(tiltRad)
        + Math.cos(elevationRad) * Math.sin(tiltRad) * Math.cos(azDiffRad);

    const beam = Math.max(0, dni * cosAoi);
    const diffuseIso = dhi * (1 + Math.cos(tiltRad)) / 2;
    const ground = ghi * ALBEDO * (1 - Math.cos(tiltRad)) / 2;

    return Math.max(0, beam + diffuseIso + ground);
}

// AC vykon celej elektrarne pre danu hodinu (obe skupiny stringov, teplotny odber, limit striedaca).
function forecastAcKw(ghi, dni, dhi, tempC, dateUtc) {
    const sun = solarPosition(dateUtc, LAT, LON);
    if (sun.elevationDeg <= 0) return 0;

    let dcWatts = 0;
    for (const s of STRINGS) {
        const poa = poaIrradiance(ghi, dni, dhi, sun.elevationDeg, sun.azimuthDeg, s.tiltDeg, s.azimuthDeg);
        const cellTemp = tempC + ((NOCT_C - 20) / 800) * poa;
        const tempFactor = 1 + (TEMP_COEF_PCT_PER_C / 100) * (cellTemp - 25);
        const stringWp = s.panels * PANEL_WP;
        dcWatts += stringWp * (poa / 1000) * Math.max(0, tempFactor);
    }

    const acKw = (dcWatts / 1000) * SYSTEM_EFFICIENCY;
    return Math.min(AC_LIMIT_KW, Math.max(0, acKw));
}

// Ziarenie bezoblacnej oblohy pre dane slnecne vysky (Meinelov utlm, vyskova korekcia).
function clearSkyIrradiance(elevationDeg) {
    if (elevationDeg <= 0.5) return { ghi: 0, dni: 0, dhi: 0 };
    const zenithDeg = 90 - elevationDeg;
    const cosZ = Math.cos(toRad(zenithDeg));
    const airMass = 1 / (cosZ + 0.50572 * Math.pow(96.07995 - zenithDeg, -1.6364));
    const hkm = Math.max(0, ELEV_M) / 1000;
    const dni = 1353 * ((1 - 0.14 * hkm) * Math.pow(CS_TAU, Math.pow(airMass, 0.678)) + 0.14 * hkm);
    const dhi = CS_DHI_FRAC * dni * cosZ;
    const ghi = dni * cosZ + dhi;
    return { ghi, dni, dhi };
}

// AC vykon celej elektrarne za bezoblacnej oblohy - horny strop pre graf/tabulku.
function clearSkyAcKw(dateUtc) {
    const sun = solarPosition(dateUtc, LAT, LON);
    if (sun.elevationDeg <= 0) return 0;
    const { ghi, dni, dhi } = clearSkyIrradiance(sun.elevationDeg);

    let dcWatts = 0;
    for (const s of STRINGS) {
        const poa = poaIrradiance(ghi, dni, dhi, sun.elevationDeg, sun.azimuthDeg, s.tiltDeg, s.azimuthDeg);
        const cellTemp = 25 + ((NOCT_C - 20) / 800) * poa; // bezoblacny den, odhad okolia 25 °C
        const tempFactor = 1 + (TEMP_COEF_PCT_PER_C / 100) * (cellTemp - 25);
        const stringWp = s.panels * PANEL_WP;
        dcWatts += stringWp * (poa / 1000) * Math.max(0, tempFactor);
    }

    const acKw = (dcWatts / 1000) * SYSTEM_EFFICIENCY;
    return Math.min(AC_LIMIT_KW, Math.max(0, acKw));
}

function localHour(dateUtc) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE, hour: '2-digit', hour12: false,
    }).formatToParts(dateUtc);
    return Number(parts.find((p) => p.type === 'hour').value);
}

function localDateKey(dateUtc) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(dateUtc); // YYYY-MM-DD
}

function daypartFor(dateUtc) {
    const h = localHour(dateUtc);
    if (h >= 12 && h < 17) return 'poobede';
    if (h >= 17 && h < 20) return 'podvečer';
    return 'neskôr';
}

// Hodinové pole pre graf (predpoveď výroby): {hour, kw, cloud}, zoradené podľa hodiny.
function hourlySeries(entries) {
    return entries
        .map((h) => ({
            hour: localHour(h.dateUtc),
            kw: Number(h.acKw.toFixed(2)),
            cloud: Number.isFinite(h.cloudPct) ? Math.round(h.cloudPct) : null,
        }))
        .sort((a, b) => a.hour - b.hour);
}

async function main() {
    const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${LAT}&longitude=${LON}`
        + '&hourly=shortwave_radiation,direct_normal_irradiance,diffuse_radiation,temperature_2m,cloud_cover'
        // 9 dni z API je rezerva na to, aby vsetkych 7 miestnych dni (karta "7 dni") malo kompletne hodinove dáta
        // aj s posunom oproti UTC.
        + '&forecast_days=9&timezone=UTC';

    const res = await fetchWithRetry(url);
    const data = await res.json();

    const times = data.hourly.time;
    const ghiArr = data.hourly.shortwave_radiation;
    const dniArr = data.hourly.direct_normal_irradiance;
    const dhiArr = data.hourly.diffuse_radiation;
    const tempArr = data.hourly.temperature_2m;
    const cloudArr = data.hourly.cloud_cover;

    const now = new Date();
    const todayKey = localDateKey(now);
    const nowHourUtc = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(),
    ));

    const hourly = times.map((t, i) => {
        const dateUtc = new Date(`${t}Z`);
        const acKw = forecastAcKw(ghiArr[i], dniArr[i], dhiArr[i], tempArr[i], dateUtc);
        return { dateUtc, acKw, localDate: localDateKey(dateUtc), cloudPct: cloudArr ? cloudArr[i] : null };
    });

    const currentHourEntry = hourly.find((h) => h.dateUtc.getTime() === nowHourUtc.getTime());
    const baselineKw = currentHourEntry ? currentHourEntry.acKw : 0;

    const futureToday = hourly.filter(
        (h) => h.localDate === todayKey && h.dateUtc.getTime() > nowHourUtc.getTime(),
    );

    let strongerWindowAhead = false;
    let windowDaypart = null;
    let peakKw = null;
    let hoursAhead = null;

    if (futureToday.length > 0) {
        let peak = futureToday[0];
        for (const h of futureToday) {
            if (h.acKw > peak.acKw) peak = h;
        }
        const meaningfullyHigher = peak.acKw >= HIGH_KW
            && peak.acKw >= baselineKw + STRONGER_WINDOW_MARGIN_KW;

        if (meaningfullyHigher) {
            strongerWindowAhead = true;
            windowDaypart = daypartFor(peak.dateUtc);
            peakKw = Number(peak.acKw.toFixed(2));
            hoursAhead = Math.round((peak.dateUtc.getTime() - nowHourUtc.getTime()) / 3600000);
        }
    }

    const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 3600 * 1000));
    const tomorrowEntries = hourly.filter((h) => h.localDate === tomorrowKey);
    const tomorrowPeakKw = tomorrowEntries.reduce((max, h) => Math.max(max, h.acKw), 0);
    const tomorrowSunny = tomorrowPeakKw >= HIGH_KW;

    const todayEntries = hourly.filter((h) => h.localDate === todayKey);

    // Karta "7 dní": dnes + 6 nasledujúcich miestnych dní, hodinová predpoveď
    // aj bezoblačný strop pre každú hodinu (heatmapa, stĺpce, krivka, tabuľka).
    const sevenDays = [];
    for (let i = 0; i < 7; i++) {
        const dayKey = localDateKey(new Date(now.getTime() + i * 24 * 3600 * 1000));
        const entries = hourly.filter((h) => h.localDate === dayKey);
        const dayHourly = hourlySeries(entries).map((h) => {
            const entry = entries.find((e) => localHour(e.dateUtc) === h.hour);
            return { ...h, clearKw: Number(clearSkyAcKw(entry.dateUtc).toFixed(2)) };
        });

        const kwhTotal = Number(dayHourly.reduce((s, h) => s + h.kw, 0).toFixed(1));
        const clearKwhTotal = Number(dayHourly.reduce((s, h) => s + h.clearKw, 0).toFixed(1));
        let peak = dayHourly[0] || { hour: null, kw: 0 };
        for (const h of dayHourly) if (h.kw > peak.kw) peak = h;
        const cloudVals = dayHourly.map((h) => h.cloud).filter((c) => c != null);
        const cloudAvgPct = cloudVals.length
            ? Math.round(cloudVals.reduce((a, b) => a + b, 0) / cloudVals.length)
            : null;

        sevenDays.push({
            date: dayKey,
            hourly: dayHourly,
            kwhTotal,
            clearKwhTotal,
            peakKw: Number(peak.kw.toFixed(2)),
            peakHour: peak.hour,
            cloudAvgPct,
        });
    }

    const output = {
        strongerWindowAhead,
        windowDaypart,
        peakKw,
        hoursAhead,
        tomorrowSunny,
        tomorrowPeakKw: Number(tomorrowPeakKw.toFixed(2)),
        hourlyToday: hourlySeries(todayEntries),
        hourlyTomorrow: hourlySeries(tomorrowEntries),
        days: sevenDays,
        updatedAt: new Date().toISOString(),
    };

    const outDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'forecast.json'), `${JSON.stringify(output, null, 2)}\n`);

    console.log('Saved data/forecast.json:', {
        ...output,
        hourlyToday: `${output.hourlyToday.length} bodov`,
        hourlyTomorrow: `${output.hourlyTomorrow.length} bodov`,
        days: `${output.days.length} dní, ${output.days.reduce((s, d) => s + d.hourly.length, 0)} bodov spolu`,
    });
}

main().catch((err) => {
    console.error('Failed to compute forecast:', err);
    process.exit(1);
});

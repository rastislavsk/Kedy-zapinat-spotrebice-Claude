// Spoločný retry helper pre fetch volania v GitHub Actions skriptoch (kiosk, Open-Meteo) —
// jeden prechodný sieťový výpadok/5xx nemá zhodiť celý beh workflow.
async function fetchWithRetry(url, options = {}, { attempts = 3, delayMs = 2000 } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            lastErr = err;
            if (i < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** i));
            }
        }
    }
    throw lastErr;
}

module.exports = { fetchWithRetry };

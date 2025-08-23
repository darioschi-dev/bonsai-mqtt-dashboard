// ======= Auth =======
const AUTH_KEY = "bonsai_authenticated";
const EXPIRATION_KEY = "bonsai_auth_expires";
const PIN_CODE = "1234";                // TODO: spostalo in backend/config
const EXPIRATION_MINUTES = 15;

function isAuthenticated() {
    const ok = sessionStorage.getItem(AUTH_KEY) === "true";
    const expires = parseInt(sessionStorage.getItem(EXPIRATION_KEY) || "0", 10);
    const valid = ok && Date.now() < expires;
    if (!valid) {
        sessionStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem(EXPIRATION_KEY);
    }
    return valid;
}

let authInProgress = null;

function requireAuth(callback) {
    if (isAuthenticated()) {
        callback();
        return;
    }

    if (!authInProgress) {
        authInProgress = new Promise((resolve) => {
            const modal = document.getElementById("auth-modal");
            const form = document.getElementById("auth-form");
            const input = document.getElementById("auth-pin-input");

            const onSubmit = (e) => {
                e.preventDefault(); // evita refresh pagina
                if (input.value === PIN_CODE) {
                    sessionStorage.setItem(AUTH_KEY, "true");
                    sessionStorage.setItem(EXPIRATION_KEY, (Date.now() + EXPIRATION_MINUTES * 60 * 1000).toString());
                    toast("🔓 Accesso autorizzato");
                    modal.classList.add("hidden");
                    form.removeEventListener("submit", onSubmit);
                    authInProgress = null;
                    resolve();
                } else {
                    toast("❌ PIN errato");
                    input.value = "";
                    input.focus();
                }
            };

            modal.classList.remove("hidden");
            input.value = "";
            input.focus();
            form.addEventListener("submit", onSubmit);
        });
    }

    authInProgress.then(callback);
}

function chiudiAuth() {
    const modal = document.getElementById("auth-modal");
    modal.classList.add("hidden");
    // non risolve la Promise → la prossima requireAuth riapre il modal
}

// ======= UI helpers =======
function toast(message, duration = 3000) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
}

function millisToAgo(tsMs) {
    const diff = Date.now() - Number(tsMs);
    if (isNaN(diff) || diff < 0) return "-";
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s fa`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}min fa`;
    const h = Math.floor(m / 60);
    return `${h}h fa`;
}

// ======= Pump control =======
function controllaPompa(action) {
    requireAuth(() => {
        fetch("/api/pump", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({action}),
        })
            .then((res) => res.json())
            .then(() => {
                fetchStatus();
                toast(`Pompa ${action === "on" ? "accesa" : "spenta"}`);
            })
            .catch(() => toast("Errore invio comando"));
    });
}

// ======= Online badge =======
function aggiornaOnlineStatus(lastSeenTs) {
    const badge = document.getElementById("esp-status");
    const ageSec = (Date.now() - Number(lastSeenTs)) / 1000;
    if (!isFinite(ageSec)) return;
    if (ageSec < 90) {
        badge.textContent = "Online";
        badge.className = "badge online";
    } else {
        badge.textContent = "Offline";
        badge.className = "badge offline";
    }
}

// ======= Dashboard fill =======
function aggiornaDashboard(data) {
    for (const key in data) {
        const domId = (key === "last_seen_ts") ? "last_seen" : key;
        const el = document.getElementById(domId);
        if (!el) continue;

        if (key === "last_seen_ts") {
            el.textContent = millisToAgo(data.last_seen_ts);
        } else if (key === "last_on") {
            const ts = Number(data.last_on);
            el.textContent = ts > 0
                ? new Date(ts).toLocaleString("it-IT", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric"
                })
                : "-";
        } else {
            el.textContent = data[key] ?? "-";
        }
    }

    if (data.last_seen_ts) aggiornaOnlineStatus(data.last_seen_ts);
    if (data.humidity != null) aggiornaHumidityCharts(data.humidity);
}

// ======= Config save / load =======
function confermaSalvataggio() {
    document.getElementById("confirm-modal").classList.remove("hidden");
}

function chiudiModal() {
    document.getElementById("confirm-modal").classList.add("hidden");
}

async function salvaConfigurazione() {
    requireAuth(async () => {
        try {
            const res = await fetch("/api/config");
            const currentConfig = await res.json();

            const newConfig = {
                wifi_ssid: document.getElementById("cfg-wifi_ssid").value || currentConfig.wifi_ssid,
                wifi_password: document.getElementById("cfg-wifi_password").value || currentConfig.wifi_password,
                mqtt_broker: document.getElementById("cfg-mqtt_broker").value || currentConfig.mqtt_broker,
                mqtt_port: Number(document.getElementById("cfg-mqtt_port").value) || currentConfig.mqtt_port,
                mqtt_username: document.getElementById("cfg-mqtt_username").value || currentConfig.mqtt_username,
                mqtt_password: document.getElementById("cfg-mqtt_password").value || currentConfig.mqtt_password,

                sensor_pin: Number(document.getElementById("cfg-sensor_pin").value) || currentConfig.sensor_pin,
                pump_pin: Number(document.getElementById("cfg-pump_pin").value) || currentConfig.pump_pin,
                relay_pin: Number(document.getElementById("cfg-relay_pin").value) || currentConfig.relay_pin,
                battery_pin: Number(document.getElementById("cfg-battery_pin").value) || currentConfig.battery_pin,

                moisture_threshold: Number(document.getElementById("cfg-moisture_threshold").value) || currentConfig.moisture_threshold,
                pump_duration: Number(document.getElementById("cfg-pump_duration").value) || currentConfig.pump_duration,
                measurement_interval: Number(document.getElementById("cfg-measurement_interval").value) || currentConfig.measurement_interval,

                debug: Boolean(document.getElementById("cfg-debug").checked),
                use_pump: Boolean(document.getElementById("cfg-use_pump").checked),
                sleep_hours: Number(document.getElementById("cfg-sleep_hours").value) || currentConfig.sleep_hours,

                use_dhcp: Boolean(document.getElementById("cfg-use_dhcp").checked),
                ip_address: document.getElementById("cfg-ip_address").value || currentConfig.ip_address,
                gateway: document.getElementById("cfg-gateway").value || currentConfig.gateway,
                subnet: document.getElementById("cfg-subnet").value || currentConfig.subnet,
            };

            await fetch("/api/config", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(newConfig),
            });

            chiudiModal();
            toast("✅ Config inviata. In attesa di ACK dal dispositivo…");
        } catch (err) {
            console.error(err);
            toast("❌ Errore salvataggio config");
        }
    });
}

function caricaConfigurazione() {
    fetch("/api/config")
        .then((res) => res.json())
        .then((cfg) => {
            document.getElementById("cfg-wifi_ssid").value = cfg.wifi_ssid || "";
            document.getElementById("cfg-wifi_password").value = cfg.wifi_password || "";
            document.getElementById("cfg-mqtt_broker").value = cfg.mqtt_broker || "";
            document.getElementById("cfg-mqtt_port").value = cfg.mqtt_port ?? 8883;
            document.getElementById("cfg-mqtt_username").value = cfg.mqtt_username || "";
            document.getElementById("cfg-mqtt_password").value = cfg.mqtt_password || "";

            document.getElementById("cfg-sensor_pin").value = cfg.sensor_pin ?? 32;
            document.getElementById("cfg-pump_pin").value = cfg.pump_pin ?? 26;
            document.getElementById("cfg-relay_pin").value = cfg.relay_pin ?? 27;
            document.getElementById("cfg-battery_pin").value = cfg.battery_pin ?? 34;

            document.getElementById("cfg-moisture_threshold").value = cfg.moisture_threshold ?? 25;
            document.getElementById("cfg-pump_duration").value = cfg.pump_duration ?? 5;
            document.getElementById("cfg-measurement_interval").value = cfg.measurement_interval ?? 1800000;

            document.getElementById("cfg-debug").checked = Boolean(cfg.debug);
            document.getElementById("cfg-use_pump").checked = Boolean(cfg.use_pump);
            document.getElementById("cfg-sleep_hours").value = cfg.sleep_hours ?? 0;

            document.getElementById("cfg-use_dhcp").checked = Boolean(cfg.use_dhcp);
            document.getElementById("cfg-ip_address").value = cfg.ip_address || "";
            document.getElementById("cfg-gateway").value = cfg.gateway || "";
            document.getElementById("cfg-subnet").value = cfg.subnet || "";
        });
}

// ======= Firmware upload =======
document.getElementById("firmware-form").addEventListener("submit", function (e) {
    e.preventDefault();
    requireAuth(() => {
        const data = new FormData(e.target);
        fetch("/upload-firmware", {method: "POST", body: data})
            .then((res) => res.json())
            .then((res) => {
                if (res.success) {
                    toast("✅ Firmware caricato con successo!");
                    toast("♻️ Riavvio ESP in corso...");
                } else {
                    toast("❌ Errore upload");
                }
            })
            .catch(() => toast("❌ Upload fallito"));
    });
});

// ======= Charts =======
const humidityData = [];
const humidityLabels = [];
let humidityGauge, humidityHistory;

function aggiornaHumidityCharts(value) {
    const v = parseFloat(value);
    if (!isNaN(v)) {
        humidityGauge.data.datasets[0].data = [v, 100 - v];
        humidityGauge.update();

        const now = new Date().toLocaleTimeString();
        if (humidityData.length > 30) {
            humidityData.shift();
            humidityLabels.shift();
        }
        humidityData.push(v);
        humidityLabels.push(now);
        humidityHistory.update();
    }
}

function initCharts() {
    const gctx = document.getElementById("humidityGauge");
    const hctx = document.getElementById("humidityHistory");

    humidityGauge = new Chart(gctx, {
        type: "doughnut",
        data: {labels: ["Umidità", ""], datasets: [{data: [0, 100]}]},
        options: {responsive: true, plugins: {legend: {display: false}}, cutout: "70%"}
    });

    humidityHistory = new Chart(hctx, {
        type: "line",
        data: {labels: humidityLabels, datasets: [{label: "Umidità (%)", data: humidityData, tension: 0.3}]},
        options: {responsive: true, scales: {y: {beginAtZero: true, max: 100}}}
    });
}

// ======= Status polling =======
function fetchStatus() {
    fetch("/status")
        .then((res) => res.json())
        .then((data) => aggiornaDashboard(data))
        .catch((err) => console.error("Errore caricamento stato", err));
}

// ======= Auto mode toggle (protetto) =======
const autoToggle = document.getElementById("auto-toggle");
autoToggle.checked = localStorage.getItem("autoMode") === "true";
autoToggle.addEventListener("change", (e) => {
    const targetChecked = e.target.checked;
    requireAuth(() => {
        localStorage.setItem("autoMode", targetChecked);
        toast(`Modalità ${targetChecked ? "automatica" : "manuale"}`);
    });
    // Se l'auth fallisce il toggle torna com'era:
    setTimeout(() => {
        if (!isAuthenticated()) e.target.checked = !targetChecked;
    }, 50);
});

// ======= MQTT over WebSocket (frontend) =======
fetch("/config/frontend")
    .then((res) => res.json())
    .then((cfg) => {
        const mqttClient = mqtt.connect(cfg.mqtt_ws_host, {
            username: cfg.mqtt_username,
            password: cfg.mqtt_password,
        });

        mqttClient.on("connect", () => {
            console.log("📡 WebSocket MQTT connesso");
            mqttClient.subscribe("bonsai/status/#");
            mqttClient.subscribe("bonsai/config/ack"); // feedback salvataggio
        });

        mqttClient.on("message", (topic, payload) => {
            const message = payload.toString();
            if (topic === "bonsai/status/humidity") aggiornaHumidityCharts(message);
            if (topic === "bonsai/status/last_seen") aggiornaOnlineStatus(Number(message));
            if (topic === "bonsai/status/pump") {
                document.getElementById("pump").textContent = message;
            }
            if (topic === "bonsai/config/ack") {
                try {
                    const ack = JSON.parse(message);
                    if (ack?.ok === false) {
                        toast("⚠️ ACK config: errore lato dispositivo");
                    } else {
                        toast("📬 ACK config ricevuto");
                    }
                } catch {
                    toast("📬 ACK config ricevuto");
                }
            }
        });
    })
    .catch((err) => console.error("❌ Errore config MQTT frontend", err));

// ======= Boot =======
caricaConfigurazione();
initCharts();
fetchStatus();
setInterval(fetchStatus, 5000);


// opzionale: pulsante Admin per bonifica retained
const clearBtn = document.getElementById("clear-retained-btn");
if (clearBtn) {
    clearBtn.addEventListener("click", () => {
        requireAuth(async () => {
            try {
                await fetch("/api/admin/clear-retained", {method: "POST"});
                toast("🧹 Retained bonificati");
            } catch {
                toast("❌ Errore bonifica retained");
            }
        });
    });
}
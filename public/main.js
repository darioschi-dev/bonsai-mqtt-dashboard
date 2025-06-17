const AUTH_KEY = "bonsai_authenticated";
const PIN_CODE = "1234"; // cambia se vuoi
const EXPIRATION_MINUTES = 15; // es: 15 minuti
const EXPIRATION_KEY = "bonsai_auth_expires";

function isAuthenticated() {
    const expires = sessionStorage.getItem(EXPIRATION_KEY);
    return (
        sessionStorage.getItem(AUTH_KEY) === "true" &&
        expires &&
        Date.now() < parseInt(expires)
    );
}

function requireAuth(callback) {
    if (isAuthenticated()) {
        callback();
        return;
    }

    const modal = document.getElementById("auth-modal");
    const input = document.getElementById("auth-pin-input");
    const button = document.getElementById("auth-submit-btn");

    modal.classList.remove("hidden");
    input.value = "";
    input.focus();

    const handler = () => {
        if (input.value === PIN_CODE) {
            sessionStorage.setItem(AUTH_KEY, "true");
            const expiresAt = Date.now() + EXPIRATION_MINUTES * 60 * 1000;
            sessionStorage.setItem(EXPIRATION_KEY, expiresAt.toString());

            toast("🔓 Accesso autorizzato");
            modal.classList.add("hidden");
            button.removeEventListener("click", handler);
            callback();
        } else {
            toast("❌ PIN errato");
            input.value = "";
            input.focus();
        }
    };

    button.addEventListener("click", handler);
}

function toast(message, duration = 3000) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
}


function controllaPompa(action) {
    requireAuth(() => {
        fetch("/pump", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        })
            .then((res) => res.json())
            .then(() => {
                fetchStatus();
                toast(`Pompa ${action === "on" ? "accesa" : "spenta"}`);
            })
            .catch(() => toast("Errore invio comando"));
    });
}

function millisToAgo(ms) {
    const uptime = parseInt(ms);
    const now = Date.now();
    const bootTime = now - uptime;
    const secondsAgo = Math.floor((now - bootTime) / 1000);

    if (secondsAgo < 60) return `${secondsAgo}s fa`;
    const minutes = Math.floor(secondsAgo / 60);
    if (minutes < 60) return `${minutes}min fa`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h fa`;
}

function aggiornaDashboard(data) {
    for (const key in data) {
        const el = document.getElementById(key);

        // ⏱ Format speciali per alcuni campi
        if (key === "last_seen" && el) {
            el.textContent = millisToAgo(data.last_seen);
        } else if (key === "last_on" && el) {
            const date = new Date(data.last_on);
            el.textContent = date.toLocaleString("it-IT", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
            });
        } else if (el) {
            el.textContent = data[key];
        }
    }

    aggiornaOnlineStatus(data.last_seen);
    aggiornaHumidityCharts(data.humidity);
}

function aggiornaOnlineStatus(lastSeenMillis) {
    const badge = document.getElementById("esp-status");

    const diffSeconds = (Date.now() - (Date.now() - lastSeenMillis)) / 1000;

    if (diffSeconds < 60) {
        badge.textContent = "Online";
        badge.className = "badge online";
    } else {
        badge.textContent = "Offline";
        badge.className = "badge offline";
    }

    // facoltativo: mostra tempo fa
    const lastSeenEl = document.getElementById("last-seen-time");
    if (lastSeenEl) {
        lastSeenEl.textContent = millisToAgo(lastSeenMillis);
    }
}

function salvaConfigurazione() {
    requireAuth(async () => {
        try {
            // 1. Carica configurazione attuale
            const res = await fetch("/api/config");
            const currentConfig = await res.json();

            // 2. Crea nuova config con i dati del form
            const newConfig = {
                wifi_ssid: document.getElementById("cfg-wifi_ssid").value || currentConfig.wifi_ssid,
                wifi_password: document.getElementById("cfg-wifi_password").value || currentConfig.wifi_password,
                mqtt_broker: document.getElementById("cfg-mqtt_broker").value || currentConfig.mqtt_broker,
                mqtt_port: parseInt(document.getElementById("cfg-mqtt_port").value) || currentConfig.mqtt_port,
                mqtt_username: document.getElementById("cfg-mqtt_username").value || currentConfig.mqtt_username,
                mqtt_password: document.getElementById("cfg-mqtt_password").value || currentConfig.mqtt_password,
                sensor_pin: parseInt(document.getElementById("cfg-sensor_pin").value) || currentConfig.sensor_pin,
                pump_pin: parseInt(document.getElementById("cfg-pump_pin").value) || currentConfig.pump_pin,
                relay_pin: parseInt(document.getElementById("cfg-relay_pin").value) || currentConfig.relay_pin,
                battery_pin: parseInt(document.getElementById("cfg-battery_pin").value) || currentConfig.battery_pin,
                moisture_threshold: parseInt(document.getElementById("cfg-moisture_threshold").value) || currentConfig.moisture_threshold,
                pump_duration: parseInt(document.getElementById("cfg-pump_duration").value) || currentConfig.pump_duration,
                measurement_interval: parseInt(document.getElementById("cfg-measurement_interval").value) || currentConfig.measurement_interval,
                debug: document.getElementById("cfg-debug").checked,
                use_pump: document.getElementById("cfg-use_pump").checked,
                sleep_hours: parseInt(document.getElementById("cfg-sleep_hours").value) || currentConfig.sleep_hours,
                use_dhcp: document.getElementById("cfg-use_dhcp").checked,
                ip_address: document.getElementById("cfg-ip_address").value || currentConfig.ip_address,
                gateway: document.getElementById("cfg-gateway").value || currentConfig.gateway,
                subnet: document.getElementById("cfg-subnet").value || currentConfig.subnet
            };

            // 3. Invia la config unita
            await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newConfig),
            });

            toast("✅ Config salvata, il dispositivo si riavvierà");
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
            document.getElementById("cfg-mqtt_port").value = cfg.mqtt_port || 8883;
            document.getElementById("cfg-mqtt_username").value = cfg.mqtt_username || "";
            document.getElementById("cfg-mqtt_password").value = cfg.mqtt_password || "";
            document.getElementById("cfg-sensor_pin").value = cfg.sensor_pin || 32;
            document.getElementById("cfg-pump_pin").value = cfg.pump_pin || 26;
            document.getElementById("cfg-relay_pin").value = cfg.relay_pin || 27;
            document.getElementById("cfg-battery_pin").value = cfg.battery_pin || 34;
            document.getElementById("cfg-moisture_threshold").value = cfg.moisture_threshold || 25;
            document.getElementById("cfg-pump_duration").value = cfg.pump_duration || 5;
            document.getElementById("cfg-measurement_interval").value = cfg.measurement_interval || 1800000;
            document.getElementById("cfg-debug").checked = cfg.debug || false;
            document.getElementById("cfg-use_pump").checked = cfg.use_pump || false;
            document.getElementById("cfg-sleep_hours").value = cfg.sleep_hours || 0;
            document.getElementById("cfg-use_dhcp").checked = cfg.use_dhcp || true;
            document.getElementById("cfg-ip_address").value = cfg.ip_address || "";
            document.getElementById("cfg-gateway").value = cfg.gateway || "";
            document.getElementById("cfg-subnet").value = cfg.subnet || "";
        });
}

function confermaSalvataggio() {
    document.getElementById("confirm-modal").classList.remove("hidden");
}

function chiudiModal() {
    document.getElementById("confirm-modal").classList.add("hidden");
}

const humidityData = [];
const humidityLabels = [];
let humidityGauge, humidityHistory;

function aggiornaHumidityCharts(value) {
    const v = parseFloat(value);
    if (!isNaN(v)) {
        humidityGauge.data.datasets[0].data[0] = v;
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
    humidityGauge = new Chart(document.getElementById("humidityGauge"), {
        type: "doughnut",
        data: {
            labels: ["Umidità"],
            datasets: [
                { data: [0, 100], backgroundColor: ["#28a745", "#e0e0e0"] },
            ],
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            cutout: "70%",
        },
    });

    humidityHistory = new Chart(document.getElementById("humidityHistory"), {
        type: "line",
        data: {
            labels: humidityLabels,
            datasets: [
                {
                    label: "Umidità (%)",
                    data: humidityData,
                    borderColor: "#28a745",
                    tension: 0.3,
                },
            ],
        },
        options: {
            responsive: true,
            scales: { y: { beginAtZero: true, max: 100 } },
        },
    });
}

function fetchStatus() {
    fetch("/status")
        .then((res) => res.json())
        .then((data) => aggiornaDashboard(data))
        .catch((err) => console.error("Errore caricamento stato", err));
}

document.getElementById("auto-toggle").checked =
    localStorage.getItem("autoMode") === "true";

document.getElementById("auto-toggle").addEventListener("change", (e) => {
    const targetChecked = e.target.checked;

    requireAuth(() => {
        localStorage.setItem("autoMode", targetChecked);
        toast(`Modalità ${targetChecked ? "automatica" : "manuale"}`);
    });

    // Attendi un attimo per vedere se l'autenticazione ha avuto successo
    setTimeout(() => {
        if (!isAuthenticated()) {
            e.target.checked = !targetChecked;
        }
    }, 100);
});

caricaConfigurazione();
initCharts();
fetchStatus();
setInterval(fetchStatus, 5000);

// main.js (alla fine)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(() => console.log('[PWA] Service Worker registrato'))
        .catch(err => console.warn('[PWA] Service Worker fallito', err));
}

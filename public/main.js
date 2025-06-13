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
    el.textContent = message;
    el.style.position = "fixed";
    el.style.bottom = "1rem";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.background = "#333";
    el.style.color = "#fff";
    el.style.padding = "0.75rem 1.5rem";
    el.style.borderRadius = "8px";
    el.style.zIndex = 9999;
    el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
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

function aggiornaDashboard(data) {
    for (const key in data) {
        const el = document.getElementById(key);
        if (el) el.textContent = data[key];
    }
    aggiornaOnlineStatus(data.last_seen);
    aggiornaHumidityCharts(data.humidity);
}

function aggiornaOnlineStatus(lastSeen) {
    const badge = document.getElementById("esp-status");
    const last = new Date(lastSeen);
    const now = new Date();
    const diff = (now - last) / 1000;
    if (diff < 60) {
        badge.textContent = "Online";
        badge.className = "badge online";
    } else {
        badge.textContent = "Offline";
        badge.className = "badge offline";
    }
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

initCharts();
fetchStatus();
setInterval(fetchStatus, 5000);

// main.js (alla fine)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(() => console.log('[PWA] Service Worker registrato'))
        .catch(err => console.warn('[PWA] Service Worker fallito', err));
}

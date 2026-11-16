// Shares the clinic data between devices.
//
// The app keeps working with localStorage as before; this script mirrors the
// shared keys to the server (/api/state), pulls changes made on other devices,
// and merges concurrent edits so nothing entered on one device is lost.
(function () {
    const BASE = (window.CLINIC_API || '').replace(/\/+$/, '');
    const API = BASE + '/state';
    const SESSION_KEY = 'clinic_session';
    // Anciennes versions : comptes et mots de passe stockés en clair dans le navigateur -> purge.
    try { localStorage.removeItem('clinic_users'); localStorage.removeItem('clinic_current_user'); } catch (e) {}
    const META_KEY = 'clinic_sync_meta';
    const POLL_INTERVAL = 60 * 1000; // 1 min (limite la consommation du serveur)

    // Shared datasets, with access to the matching variable inside app.js.
    const SYNCED = {
        clinic_patients: { get: () => patients, set: v => { patients = v; } },
        clinic_external_exams: { get: () => externalExamsList, set: v => { externalExamsList = v; } },
        clinic_pharmacy: { get: () => pharmacyInventory, set: v => { pharmacyInventory = v; } },
        clinic_pharmacy_supplies: { get: () => pharmacySupplies, set: v => { pharmacySupplies = v; } },
        clinic_pharmacy_revenues: { get: () => pharmacyRevenues, set: v => { pharmacyRevenues = v; } },
        clinic_last_reset: { get: () => lastResetTimestamp, set: v => { lastResetTimestamp = v; } },
        clinic_finance_pin: { get: () => FINANCE_PIN, set: v => { FINANCE_PIN = v; } }
    };
    // Keys stored as plain strings rather than JSON.
    const RAW_KEYS = new Set(['clinic_last_reset', 'clinic_finance_pin']);

    const rawGet = Storage.prototype.getItem;
    const rawSet = Storage.prototype.setItem;
    const rawRemove = Storage.prototype.removeItem;
    const store = {
        get: k => rawGet.call(localStorage, k),
        set: (k, v) => rawSet.call(localStorage, k, v),
        remove: k => rawRemove.call(localStorage, k)
    };

    // versions: last server version seen per key
    // pending: keys changed locally and not yet saved on the server
    // base: value of each pending key before the local change (for merging)
    let meta = readMeta();
    let appStarted = false;
    let syncing = null;
    let pushTimer = null;

    function readMeta() {
        try {
            const m = JSON.parse(store.get(META_KEY));
            if (m && m.versions && m.pending && m.base) return m;
        } catch (e) {}
        return { versions: {}, pending: {}, base: {} };
    }

    function saveMeta() {
        store.set(META_KEY, JSON.stringify(meta));
    }

    function decode(key, str) {
        if (str === null || str === undefined) return null;
        if (RAW_KEYS.has(key)) return str;
        try { return JSON.parse(str); } catch (e) { return null; }
    }

    function encode(key, value) {
        return RAW_KEYS.has(key) ? String(value) : JSON.stringify(value);
    }

    function markPending(key, previousStr) {
        if (!meta.pending[key]) {
            meta.pending[key] = true;
            meta.base[key] = decode(key, previousStr);
        }
        saveMeta();
    }

    // Track every change the app makes to a shared key.
    Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key in SYNCED) {
            const previous = store.get(key);
            rawSet.call(this, key, value);
            if (previous !== String(value)) {
                markPending(key, previous);
                schedulePush();
            }
            return;
        }
        return rawSet.call(this, key, value);
    };

    // Data saved on this device before syncing existed gets merged into the shared copy.
    for (const key in SYNCED) {
        if (meta.versions[key] === undefined && !meta.pending[key] && store.get(key) !== null) {
            meta.pending[key] = true;
            meta.base[key] = null;
        }
    }
    saveMeta();

    function readSession() {
        try {
            const x = JSON.parse(store.get(SESSION_KEY));
            if (x && x.token && x.user && x.user.username) return x;
        } catch (e) {}
        return null;
    }
    function writeSession(x) { store.set(SESSION_KEY, JSON.stringify(x)); }
    function sessionCredentials() { return readSession(); }

    // Appel authentifié (jeton Bearer). `path` est relatif à /state.
    async function request(method, path, body, session) {
        const sess = session || readSession();
        if (!sess) throw Object.assign(new Error('not logged in'), { status: 401 });
        const res = await fetch(API + path, {
            method,
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sess.token },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (res.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
        return res;
    }

    // Appel authentifié hors /state (utilisateurs, mot de passe).
    async function apiCall(method, path, body) {
        const sess = readSession();
        if (!sess) throw Object.assign(new Error('not logged in'), { status: 401 });
        const res = await fetch(BASE + path, {
            method,
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sess.token },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let data = {};
        try { data = await res.json(); } catch (e) {}
        if (res.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
        if (!res.ok) throw Object.assign(new Error(data.error || ('http ' + res.status)), { status: res.status, code: data.error });
        return data;
    }

    // Three-way merge of lists: keeps additions, edits and deletions from both sides.
    // Anything that is not a list: the local version wins.
    function merge(base, local, remote) {
        if (!Array.isArray(local) || !Array.isArray(remote)) return local;
        const keyOf = item => (item && typeof item === 'object' && (item.id || item.username)) || JSON.stringify(item);
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const toMap = list => new Map((Array.isArray(list) ? list : []).map(i => [keyOf(i), i]));
        const baseMap = toMap(base), localMap = toMap(local), remoteMap = toMap(remote);

        const result = [];
        for (const [k, remoteItem] of remoteMap) {
            if (localMap.has(k)) {
                const localItem = localMap.get(k);
                const localUnchanged = baseMap.has(k) && same(localItem, baseMap.get(k));
                result.push(localUnchanged ? remoteItem : localItem);
            } else if (!baseMap.has(k)) {
                result.push(remoteItem); // added on another device
            } // otherwise deleted on this device
        }
        for (const [k, localItem] of localMap) {
            if (remoteMap.has(k)) continue;
            if (baseMap.has(k) && same(localItem, baseMap.get(k))) continue; // deleted on another device
            result.push(localItem); // added (or edited) on this device
        }
        return result;
    }

    // Replace remote items that are identical to what the app already holds by the
    // app's own objects, so open screens keep working on the same references.
    function reuseObjects(current, incoming) {
        if (!Array.isArray(current) || !Array.isArray(incoming)) return incoming;
        const byJson = new Map(current.map(i => [JSON.stringify(i), i]));
        return incoming.map(i => byJson.get(JSON.stringify(i)) || i);
    }

    // Store a value coming from the server and hand it to the running app.
    function applyValue(key, value) {
        store.set(key, encode(key, value));
        if (!appStarted) return;
        try {
            SYNCED[key].set(reuseObjects(SYNCED[key].get(), value));
        } catch (e) {}
    }

    async function pushKey(key, credentials) {
        const local = decode(key, store.get(key));
        if (local === null) {
            delete meta.pending[key];
            delete meta.base[key];
            saveMeta();
            return false;
        }
        let value = local;
        let baseVersion = meta.versions[key] || 0;
        let changedLocally = false;

        for (let attempt = 0; attempt < 5; attempt++) {
            const res = await request('PUT', '/' + key, { value, baseVersion }, credentials);
            if (res.ok) {
                const { version } = await res.json();
                meta.versions[key] = version;
                if (store.get(key) === encode(key, value)) {
                    delete meta.pending[key];
                    delete meta.base[key];
                } else {
                    // The app changed the key again meanwhile: push that next.
                    meta.base[key] = value;
                }
                saveMeta();
                return changedLocally;
            }
            if (res.status !== 409) throw new Error('save failed: ' + res.status);

            const remote = await res.json();
            value = remote.value === null ? local : merge(meta.base[key], local, remote.value);
            baseVersion = remote.version;
            meta.base[key] = remote.value;
            if (JSON.stringify(value) !== JSON.stringify(local)) {
                applyValue(key, value);
                changedLocally = true;
            }
        }
        throw new Error('too many conflicts for ' + key);
    }

    // Push local changes, then pull whatever other devices changed.
    function syncNow(credentials) {
        if (syncing) return syncing.catch(() => {}).then(() => syncNow(credentials));
        syncing = (async () => {
            let updated = false;
            for (const key of Object.keys(meta.pending)) {
                if (await pushKey(key, credentials)) updated = true;
            }

            const metaRes = await request('GET', '?meta=1', undefined, credentials);
            if (!metaRes.ok) throw new Error('load failed: ' + metaRes.status);
            const versions = await metaRes.json();
            const stale = Object.keys(versions).filter(k => k in SYNCED && !meta.pending[k] && versions[k].version !== meta.versions[k]);
            if (stale.length) {
                const res = await request('GET', '', undefined, credentials);
                if (!res.ok) throw new Error('load failed: ' + res.status);
                const all = await res.json();
                for (const key of stale) {
                    if (!all[key] || meta.pending[key]) continue;
                    applyValue(key, all[key].value);
                    meta.versions[key] = all[key].version;
                    updated = true;
                }
                saveMeta();
            }
            setStatus('ok');
            return updated;
        })().finally(() => { syncing = null; });
        return syncing;
    }

    function schedulePush() {
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => backgroundSync(), 500);
    }

    async function backgroundSync() {
        if (!appStarted || !sessionCredentials()) return;
        try {
            const updated = await syncNow();
            if (updated) showUpdateBanner();
        } catch (e) {
            console.error('[sync] échec de synchronisation :', e);
            setStatus(e.status === 401 ? 'auth' : 'offline', describeError(e));
        }
    }

    // Short, readable cause shown next to the offline indicator (also logged in the console).
    function describeError(e) {
        const msg = String((e && e.message) || e);
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'serveur injoignable';
        const m = msg.match(/(\d{3})/);
        return m ? 'erreur serveur ' + m[1] : msg.slice(0, 40);
    }

    // Small indicator so users know whether their changes reached the server.
    let statusEl = null;
    function setStatus(state, detail) {
        if (!document.body) return;
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;padding:4px 10px;border-radius:12px;font:12px sans-serif;color:#fff;opacity:.85;pointer-events:none;';
            document.body.appendChild(statusEl);
        }
        const hasPending = Object.keys(meta.pending).length > 0;
        if (state === 'ok' && !hasPending) {
            statusEl.textContent = '✓ Synchronisé';
            statusEl.style.background = '#2e7d32';
        } else if (state === 'auth') {
            statusEl.textContent = '⚠ Reconnectez-vous pour synchroniser';
            statusEl.style.background = '#c62828';
        } else {
            statusEl.textContent = '⏳ Hors ligne – modifications en attente' + (detail ? ' (' + detail + ')' : '');
            statusEl.style.background = '#ef6c00';
        }
    }

    let bannerEl = null;
    function showUpdateBanner() {
        if (bannerEl || !document.body) return;
        bannerEl = document.createElement('div');
        bannerEl.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;background:#1565c0;color:#fff;padding:10px 16px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;';
        bannerEl.innerHTML = '<span>Des données ont été modifiées sur un autre appareil.</span>';
        const btn = document.createElement('button');
        btn.textContent = 'Actualiser';
        btn.style.cssText = 'background:#fff;color:#1565c0;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:bold;';
        btn.onclick = () => location.reload();
        bannerEl.appendChild(btn);
        document.body.appendChild(bannerEl);
    }

    function startApp() {
        const script = document.createElement('script');
        script.src = 'app.js';
        script.onload = () => {
            appStarted = true;
            // Pas d'interrogation quand l'onglet est en arrière-plan ; la synchro reprend au retour (focus / visibilitychange).
            setInterval(() => { if (!document.hidden) backgroundSync(); }, POLL_INTERVAL);
            window.addEventListener('focus', backgroundSync);
            window.addEventListener('online', backgroundSync);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') backgroundSync();
            });
        };
        document.body.appendChild(script);
    }

    window.ClinicSync = {
        currentUser() { const x = readSession(); return x ? x.user : null; },
        // Résultat : {status:'ok', user} | {status:'invalid'} | {status:'locked'} | {status:'offline'}
        async login(username, password) {
            let res;
            try {
                res = await fetch(BASE + '/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
            } catch (e) {
                return { status: 'offline' };
            }
            if (res.status === 401) return { status: 'invalid' };
            if (res.status === 429) return { status: 'locked' };
            if (!res.ok) return { status: 'offline' };
            const data = await res.json();
            const sess = { token: data.token, user: data.user };
            writeSession(sess);
            try { await syncNow(sess); } catch (e) { console.error('[sync] première synchro :', e); }
            return { status: 'ok', user: data.user };
        },
        setToken(token) { const x = readSession(); if (x && token) { x.token = token; writeSession(x); } },
        logout() { store.remove(SESSION_KEY); },
        api: apiCall
    };

    (async function boot() {
        if (sessionCredentials()) {
            try {
                await syncNow();
            } catch (e) {
                if (e.status === 401) store.remove(SESSION_KEY); // password changed elsewhere: log in again
                console.error('[sync] échec au démarrage :', e);
                setStatus(e.status === 401 ? 'auth' : 'offline', describeError(e));
            }
        }
        startApp();
    })();
})();

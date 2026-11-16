let FINANCE_PIN = localStorage.getItem('clinic_finance_pin') || '1234';

let idleTimer = null;
const IDLE_TIMEOUT = 30 * 60 * 1000;

function resetIdleTimer() {
    if (!currentUser) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        saveToStorage();
        currentUser = null;
        ClinicSync.logout();
        alert("Session expirée après 30 minutes d'inactivité. Votre travail a été sauvegardé et vous avez été déconnecté(e).");
        location.reload();
    }, IDLE_TIMEOUT);
}

window.addEventListener('mousemove', resetIdleTimer);
window.addEventListener('keypress', resetIdleTimer);
window.addEventListener('click', resetIdleTimer);
window.addEventListener('scroll', resetIdleTimer);

function getCurrentDateTimeFormatted() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'America/Port-au-Prince',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    return formatter.format(now);
}

function getCurrentDateTimeInUTC5ISO() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Port-au-Prince',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(now);
    const p = {};
    parts.forEach(pt => p[pt.type] = pt.value);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function formatISOToReadable(isoString) {
    if (!isoString) return '--';
    const [datePart, timePart] = isoString.split('T');
    if (!datePart || !timePart) return isoString;
    const [y, m, d] = datePart.split('-');
    return `${d}/${m}/${y} ${timePart}`;
}

// Liste des comptes : chargée depuis le serveur (administrateur uniquement). Jamais de mots de passe côté navigateur.
let userAccounts = [];

let currentUser = ClinicSync.currentUser();
let lastResetTimestamp = localStorage.getItem('clinic_last_reset') || '';

let clinicExamTypes = [
    "🧪 Biologie & Laboratoire (FSC, Glycémie)",
    "🫀 Électrocardiogramme (ECG / EKG)",
    "📻 Échographie Abdominale / Pelvienne",
    "🔬 Radiographie Standard (RX Thorax / Os)",
    "🧠 Scanner (TDM) / IRM",
    "🩺 Bilan Rénal / Hépatique"
];

let patients = JSON.parse(localStorage.getItem('clinic_patients')) || [
    {
        id: 'MUV-1001',
        name: 'Jean Marie',
        nickname: 'Jojo',
        age: 34,
        dob: '1992-05-14',
        pob: 'Port-au-Prince',
        nif: '004-321-890-1',
        mother: 'Marie Claire',
        phone: '+509 3700 1122',
        address: 'Delmas 33, Rue 4',
        eContact: 'Claire Marie',
        eRel: 'Sœur',
        ePhone: '+509 3600 4455',
        recoveryHistory: [],
        visits: [
            {
                id: 'v1',
                dateTime: '2026-10-25T09:30',
                consultationReason: 'Fatigue générale et maux de tête',
                height: 175, weight: 78, bp: '120/80', hr: 72, temp: 36.6,
                hpi: 'Fatigue modérée.',
                ros: ['Asthénie / Fatigue'],
                labResults: '', ekgResults: '', sonoResults: '', imagingResults: '',
                assessment: 'Syndrome asthénique.',
                plan: 'Multivitamines.',
                docName: 'Dr. Vervil',
                isSpecialEvent: false, isReferred: false, isDeceased: false,
                consultPaidPart: 1000, consultDueAmount: 0,
                specialDetails: '',
                adminExamsList: [
                    { examName: "🧪 Biologie & Laboratoire (FSC, Glycémie)", status: "Payé", montantVerse: 1200, montantDette: 0, deliveryStatus: "Livré", deliveryDate: "2026-10-25" }
                ]
            }
        ]
    }
];

let externalExamsList = JSON.parse(localStorage.getItem('clinic_external_exams')) || [];
let pharmacyInventory = JSON.parse(localStorage.getItem('clinic_pharmacy')) || [
    { id: 'p1', pmuvCode: 'PMUV-MED-001', commercialName: 'Panadol', activeIngredient: 'Paracétamol', form: '500mg', qty: 150, price: 15.00, unit: 'comprimé/gélule' },
    { id: 'p2', pmuvCode: 'PMUV-MED-002', commercialName: 'Amoxil', activeIngredient: 'Amoxicilline', form: '500mg', qty: 80, price: 50.00, unit: 'feuille' }
];

let pharmacySupplies = JSON.parse(localStorage.getItem('clinic_pharmacy_supplies')) || [];
let pharmacyRevenues = JSON.parse(localStorage.getItem('clinic_pharmacy_revenues')) || [];
let currentRevenueMedLines = [];

let activePatientId = null;
let activeVisitId = null;
let isEditingProfile = false;

let recognition = null;
let isRecordingHPI = false;
let dictationBase = '';

// The app is started by sync.js once shared data is loaded, possibly after DOMContentLoaded.
function onAppReady(fn) {
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', fn);
    else fn();
}

onAppReady(() => {
    if (currentUser) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('userBar').style.display = 'flex';
        document.getElementById('currentUserDisplay').innerText = currentUser.fullName || currentUser.username;
        const roleLabels = { admin: 'Administrateur', medecin: 'Médecin', reception: 'Réception' };
        document.getElementById('currentUserRoleBadge').innerText = roleLabels[currentUser.role] || currentUser.role;

        applyRolePermissions();
        init();
        resetIdleTimer();
    }
    initSpeechRecognition();
});

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'fr-FR';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
            let transcript = '';
            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            const hpiArea = document.getElementById('txtHPI');
            if (hpiArea) {
                hpiArea.value = dictationBase + transcript;
            }
        };

        recognition.onerror = (event) => {
            console.error("Erreur de reconnaissance vocale :", event.error);
            stopDictation();
        };

        recognition.onend = () => {
            if (isRecordingHPI) {
                const hpiArea = document.getElementById('txtHPI');
                dictationBase = hpiArea && hpiArea.value ? hpiArea.value.replace(/\s*$/, ' ') : '';
                try { recognition.start(); } catch (e) {}
            }
        };
    }
}

function toggleDictation() {
    if (!recognition) {
        alert("La dictée vocale n'est pas supportée par votre navigateur (essayez Google Chrome).");
        return;
    }

    const btnText = document.getElementById('dictateBtnText');
    const badge = document.getElementById('dictationStatusBadge');
    const btn = document.getElementById('btnDictateHPI');

    if (!isRecordingHPI) {
        try {
            const hpiArea = document.getElementById('txtHPI');
            dictationBase = hpiArea && hpiArea.value ? hpiArea.value.replace(/\s*$/, ' ') : '';
            recognition.start();
            isRecordingHPI = true;
            btnText.innerText = 'Arrêter la dictée';
            btn.style.borderColor = 'var(--danger-red)';
            btn.style.color = 'var(--danger-red)';
            badge.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    } else {
        stopDictation();
    }
}

function stopDictation() {
    if (recognition && isRecordingHPI) {
        try { recognition.stop(); } catch (e) {}
    }
    isRecordingHPI = false;
    const btnText = document.getElementById('dictateBtnText');
    const badge = document.getElementById('dictationStatusBadge');
    const btn = document.getElementById('btnDictateHPI');
    if (btnText) btnText.innerText = 'Activer Dictée Vocale';
    if (btn) {
        btn.style.borderColor = 'var(--border-color)';
        btn.style.color = 'var(--text-main)';
    }
    if (badge) badge.style.display = 'none';
}

async function handleLogin(e) {
    e.preventDefault();
    const uInput = document.getElementById('loginUsername').value.trim();
    const pInput = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const result = await ClinicSync.login(uInput, pInput);
    if (btn) btn.disabled = false;

    if (result.status !== 'ok') {
        const messages = {
            invalid: 'Identifiants incorrects.',
            locked: 'Trop de tentatives. Réessayez dans 15 minutes.',
            offline: 'Connexion au serveur impossible. Vérifiez Internet puis réessayez.'
        };
        errEl.innerText = messages[result.status] || messages.invalid;
        errEl.style.display = 'block';
        return;
    }
    errEl.style.display = 'none';
    // Recharge la page : l'application démarre avec les données partagées du serveur.
    location.reload();
}

function handleLogout() {
    if (confirm("Voulez-vous vraiment vous déconnecter de la session ?")) {
        clearTimeout(idleTimer);
        currentUser = null;
        ClinicSync.logout();
        document.getElementById('userBar').style.display = 'none';
        hideAllViews();
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('loginUsername').value = '';
        document.getElementById('loginPassword').value = '';
    }
}

function openSelfPasswordModal() {
    document.getElementById('selfOldPass').value = '';
    document.getElementById('selfNewPass').value = '';
    document.getElementById('selfConfirmPass').value = '';
    document.getElementById('selfPasswordModal').style.display = 'flex';
}

function closeSelfPasswordModal() {
    document.getElementById('selfPasswordModal').style.display = 'none';
}

async function saveSelfPassword(e) {
    e.preventDefault();
    const oldPass = document.getElementById('selfOldPass').value;
    const newPass = document.getElementById('selfNewPass').value;
    const confirmPass = document.getElementById('selfConfirmPass').value;

    if (!newPass || newPass.length < 8) {
        alert('Le nouveau mot de passe doit contenir au moins 8 caractères.');
        return;
    }
    if (newPass !== confirmPass) {
        alert('Les nouveaux mots de passe ne correspondent pas.');
        return;
    }
    try {
        const data = await ClinicSync.api('POST', '/password', { oldPassword: oldPass, newPassword: newPass });
        ClinicSync.setToken(data.token);
        closeSelfPasswordModal();
        alert('Votre mot de passe a été modifié avec succès !');
    } catch (err) {
        alert(userAdminErrorMessage(err));
    }
}

function userAdminErrorMessage(err) {
    const map = {
        wrong_password: 'Le mot de passe actuel est incorrect.',
        password_too_short: 'Le mot de passe doit contenir au moins 8 caractères.',
        password_required: 'Un mot de passe est requis pour un nouveau compte.',
        last_admin: 'Impossible : il doit rester au moins un administrateur.',
        cannot_delete_self: 'Vous ne pouvez pas supprimer votre propre compte.',
        invalid_username: "Nom d'utilisateur invalide.",
        invalid_role: 'Rôle invalide.',
        forbidden: "Action réservée à l'administrateur.",
        not_found: 'Compte introuvable.'
    };
    if (err && err.status === 401) return 'Session expirée : reconnectez-vous.';
    if (err && map[err.code]) return map[err.code];
    return 'Opération impossible (serveur injoignable ?). Réessayez.';
}

function applyRolePermissions() {
    const r = currentUser.role;
    document.getElementById('cardPharmacy').style.display = (r === 'admin') ? 'flex' : 'none';
    document.getElementById('cardReports').style.display = (r === 'admin' || r === 'medecin') ? 'flex' : 'none';
    document.getElementById('cardAdmin').style.display = (r === 'admin') ? 'flex' : 'none';
    document.getElementById('cardUsers').style.display = (r === 'admin') ? 'flex' : 'none';

    document.getElementById('mentionsSpecialesCard').style.display = (r === 'admin') ? 'block' : 'none';

    const reportStatusOpt = document.getElementById('reportStatusOption');
    const reportPatientDebtsOpt = document.getElementById('reportPatientDebtsOption');
    const reportRecoveryHistoryOpt = document.getElementById('reportRecoveryHistoryOption');
    const reportAllDebtorsOpt = document.getElementById('reportAllDebtorsOption');

    if (r === 'medecin') {
        reportStatusOpt.style.display = 'none';
        reportPatientDebtsOpt.style.display = 'none';
        reportRecoveryHistoryOpt.style.display = 'none';
        reportAllDebtorsOpt.style.display = 'none';
        document.getElementById('reportModeSelect').value = 'patient';
    } else if (r === 'admin') {
        reportStatusOpt.style.display = 'block';
        reportPatientDebtsOpt.style.display = 'block';
        reportRecoveryHistoryOpt.style.display = 'block';
        reportAllDebtorsOpt.style.display = 'block';
    }

    const consultForm = document.getElementById('consultForm');
    if (r === 'reception') {
        consultForm.style.pointerEvents = 'none';
        consultForm.style.opacity = '0.6';
        document.getElementById('btnNewVisit').style.display = 'none';
        document.getElementById('deletePatientBtn').style.display = 'none';
    } else {
        consultForm.style.pointerEvents = 'auto';
        consultForm.style.opacity = '1';
        document.getElementById('btnNewVisit').style.display = 'inline-block';
        document.getElementById('deletePatientBtn').style.display = 'inline-block';
    }
}

function init() {
    showHomeSection();
    populateExamDropdowns();
}

async function showUserManagementModal() {
    document.getElementById('userManagementModal').style.display = 'flex';
    await loadUserAccounts();
}

async function loadUserAccounts() {
    try {
        const data = await ClinicSync.api('GET', '/users');
        userAccounts = data.users || [];
        renderUserListTable();
    } catch (err) {
        alert(userAdminErrorMessage(err));
    }
}

function closeUserManagementModal() {
    document.getElementById('userManagementModal').style.display = 'none';
}

function renderUserListTable() {
    const tbody = document.getElementById('userListTableBody');
    tbody.innerHTML = '';
    userAccounts.forEach((u, idx) => {
        const tr = document.createElement('tr');
        const isSelf = currentUser && u.username === currentUser.username;
        tr.innerHTML = `
            <td><strong>${escapeHtml(u.username)}</strong></td>
            <td>${escapeHtml(u.fullName || 'N/A')}</td>
            <td>${escapeHtml(u.role)}</td>
            <td>
                <div style="display:flex; gap:4px;">
                    <button class="btn btn-sec" style="font-size:0.75rem; padding:3px 8px;" onclick="editUserPassword(${idx})">Modifier MDP</button>
                    ${isSelf ? '' : `<button class="btn btn-danger" style="font-size:0.75rem; padding:3px 8px;" onclick="deleteUserAccount(${idx})">Suppr.</button>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function editUserPassword(idx) {
    const u = userAccounts[idx];
    document.getElementById('uUsername').value = u.username;
    document.getElementById('uPassword').value = '';
    document.getElementById('uPassword').focus();
    document.getElementById('uFullName').value = u.fullName || '';
    document.getElementById('uRole').value = u.role;
    alert(`Saisissez le nouveau mot de passe pour "${u.username}" dans le formulaire ci-dessus (laisser vide pour ne changer que le nom ou le rôle), puis cliquez sur "Enregistrer Utilisateur".`);
}

async function saveUserAccount(e) {
    e.preventDefault();
    const uName = document.getElementById('uUsername').value.trim();
    const uPass = document.getElementById('uPassword').value;
    const uFull = document.getElementById('uFullName').value.trim();
    const uRole = document.getElementById('uRole').value;
    const existed = userAccounts.some(u => u.username === uName.toLowerCase());

    try {
        const data = await ClinicSync.api('POST', '/users', { username: uName, password: uPass, role: uRole, fullName: uFull });
        if (data.token) ClinicSync.setToken(data.token);
        alert(existed ? `Compte "${uName}" mis à jour avec succès !` : 'Nouveau compte utilisateur enregistré avec succès !');
    } catch (err) {
        alert(userAdminErrorMessage(err));
        return;
    }
    await loadUserAccounts();
    document.getElementById('uUsername').value = '';
    document.getElementById('uPassword').value = '';
    document.getElementById('uFullName').value = '';
}

async function deleteUserAccount(idx) {
    const u = userAccounts[idx];
    if (!u || !confirm(`Supprimer l'utilisateur "${u.username}" ?`)) return;
    try {
        await ClinicSync.api('DELETE', '/users/' + encodeURIComponent(u.username));
    } catch (err) {
        alert(userAdminErrorMessage(err));
        return;
    }
    await loadUserAccounts();
}

function populateExamDropdowns() {
    const clinicSelect = document.getElementById('inputClinicExamName');
    const extSelect = document.getElementById('inputExtExam');
    if (!clinicSelect || !extSelect) return;

    let html = '';
    clinicExamTypes.forEach(t => {
        html += `<option value="${t}">${t}</option>`;
    });
    clinicSelect.innerHTML = html;
    extSelect.innerHTML = html;
}

function saveToStorage() {
    localStorage.setItem('clinic_patients', JSON.stringify(patients));
    localStorage.setItem('clinic_external_exams', JSON.stringify(externalExamsList));
    localStorage.setItem('clinic_pharmacy', JSON.stringify(pharmacyInventory));
    localStorage.setItem('clinic_pharmacy_supplies', JSON.stringify(pharmacySupplies));
    localStorage.setItem('clinic_pharmacy_revenues', JSON.stringify(pharmacyRevenues));
    localStorage.setItem('clinic_last_reset', lastResetTimestamp);
}

function toggleCollapsibleSection(bodyId, iconId) {
    const body = document.getElementById(bodyId);
    const icon = document.getElementById(iconId);
    if (body.style.display === 'none') {
        body.style.display = 'block';
        icon.innerText = '▼ Replier';
    } else {
        body.style.display = 'none';
        icon.innerText = '▶ Déplier';
    }
}

function collapseExamSectionByDefault() {
    const body = document.getElementById('examCollapsibleBody');
    const icon = document.getElementById('examToggleIcon');
    if (body && icon) {
        body.style.display = 'none';
        icon.innerText = '▶ Déplier';
    }
}

function calculateAgeFromDate(dobString) {
    if (!dobString) return '';
    const dob = new Date(dobString);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age >= 0 ? age : 0;
}

function calculateAgeFromModalDOB() {
    const dobVal = document.getElementById('mDOB').value;
    const calculatedAge = calculateAgeFromDate(dobVal);
    if (calculatedAge !== '') document.getElementById('mAge').value = calculatedAge;
}

function calculateAgeFromEditDOB() {
    const dobVal = document.getElementById('editDOB').value;
    const calculatedAge = calculateAgeFromDate(dobVal);
    if (calculatedAge !== '') document.getElementById('editAge').value = calculatedAge;
}

function patientHasExamDebt(pt) {
    if (!pt) return false;
    let hasDebt = false;
    if (pt.visits) {
        pt.visits.forEach(vst => {
            if (vst.adminExamsList) {
                vst.adminExamsList.forEach(ex => {
                    let debtVal = ex.montantDette !== undefined ? parseFloat(ex.montantDette || 0) : (ex.status === 'Balance due' ? parseFloat(ex.amount || 0) : 0);
                    if (debtVal > 0) hasDebt = true;
                });
            }
        });
    }
    return hasDebt;
}

function patientHasConsultDebt(pt) {
    if (!pt || !pt.visits) return false;
    return pt.visits.some(vst => parseFloat(vst.consultDueAmount || 0) > 0);
}

function patientHasPharmacyDebt(pt) {
    return !!pt.hasPharmacyDebt; 
}


// --- Documents du dossier patient ---
const MAX_PATIENT_DOC_SIZE = 1.5 * 1024 * 1024; // 1,5 Mo (limite du stockage local)

function handlePatientDocumentUpload(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    const patient = patients.find(pt => pt.id === activePatientId);
    if (!patient) {
        alert('Aucun patient actif.');
        input.value = '';
        return;
    }
    if (file.size > MAX_PATIENT_DOC_SIZE) {
        alert('Fichier trop volumineux (maximum 1,5 Mo). Réduisez-le ou compressez-le avant de le charger.');
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        if (!patient.documents) patient.documents = [];
        patient.documents.push({
            id: 'doc_' + Date.now(),
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            dateTime: getCurrentDateTimeInUTC5ISO(),
            dataUrl: reader.result
        });
        try {
            saveToStorage();
        } catch (e) {
            patient.documents.pop();
            alert("Stockage plein : impossible d'enregistrer ce document.");
        }
        renderPatientDocuments(patient);
        input.value = '';
    };
    reader.onerror = () => {
        alert('Erreur de lecture du fichier.');
        input.value = '';
    };
    reader.readAsDataURL(file);
}

function renderPatientDocuments(patient) {
    const card = document.getElementById('patientDocumentsCard');
    const tbody = document.getElementById('patientDocumentsTableBody');
    if (!card || !tbody) return;
    const docs = (patient && patient.documents) || [];
    tbody.innerHTML = '';
    card.style.display = docs.length ? 'block' : 'none';

    docs.forEach(d => {
        const tr = document.createElement('tr');
        const tdDate = document.createElement('td');
        tdDate.textContent = (d.dateTime || '').replace('T', ' ').slice(0, 16);
        const tdName = document.createElement('td');
        tdName.textContent = d.name;
        const tdAct = document.createElement('td');

        const btnOpen = document.createElement('button');
        btnOpen.type = 'button';
        btnOpen.className = 'btn btn-sec';
        btnOpen.style.cssText = 'font-size:0.75rem; padding:3px 8px; margin-right:4px;';
        btnOpen.textContent = '👁️ Voir';
        btnOpen.onclick = () => openPatientDocument(d.id);

        const btnDl = document.createElement('button');
        btnDl.type = 'button';
        btnDl.className = 'btn btn-sec';
        btnDl.style.cssText = 'font-size:0.75rem; padding:3px 8px; margin-right:4px;';
        btnDl.textContent = '⬇️ Télécharger';
        btnDl.onclick = () => downloadPatientDocument(d.id);

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn btn-danger';
        btnDel.style.cssText = 'font-size:0.75rem; padding:3px 8px;';
        btnDel.textContent = 'Supprimer';
        btnDel.onclick = () => deletePatientDocument(d.id);
        if (currentUser && currentUser.role === 'reception') btnDel.style.display = 'none';

        tdAct.append(btnOpen, btnDl, btnDel);
        tr.append(tdDate, tdName, tdAct);
        tbody.appendChild(tr);
    });
}

function openPatientDocument(docId) {
    const patient = patients.find(pt => pt.id === activePatientId);
    const d = patient && (patient.documents || []).find(x => x.id === docId);
    if (d) viewStoredFile(d.dataUrl, d.type, d.name);
}

function downloadPatientDocument(docId) {
    const patient = patients.find(pt => pt.id === activePatientId);
    const d = patient && (patient.documents || []).find(x => x.id === docId);
    if (d) downloadStoredFile(d.dataUrl, d.type, d.name);
}

function deletePatientDocument(docId) {
    const patient = patients.find(pt => pt.id === activePatientId);
    if (!patient || !patient.documents) return;
    const d = patient.documents.find(x => x.id === docId);
    if (!d || !confirm(`Supprimer le document « ${d.name} » ?`)) return;
    patient.documents = patient.documents.filter(x => x.id !== docId);
    saveToStorage();
    renderPatientDocuments(patient);
}

function selectPatient(id) {
    activePatientId = id;
    const patient = patients.find(p => p.id === id);
    renderDemographics(patient);
    renderPatientDocuments(patient);
    showConsultationSection();
    if (patient.visits.length === 0) {
        addNewVisit();
    } else {
        switchVisit(patient.visits[patient.visits.length - 1].id);
    }
}

function renderDemographics(p) {
    const currentVisit = p.visits.find(v => v.id === activeVisitId);
    const isDeceased = currentVisit ? currentVisit.isDeceased : false;
    const isReferred = currentVisit ? currentVisit.isReferred : false;
    const consultDue = currentVisit ? parseFloat(currentVisit.consultDueAmount || 0) : 0;
    
    const bannerNameElem = document.getElementById('bannerName');
    bannerNameElem.className = '';

    let titleSuffix = '';
    if (isDeceased) {
        titleSuffix = ' [DÉCÉDÉ(E)]';
        bannerNameElem.classList.add('patient-deceased-title');
    } else if (isReferred) {
        titleSuffix = ' [RÉFÉRÉ]';
        bannerNameElem.classList.add('patient-referred-title');
    } else if (consultDue > 0) {
        titleSuffix = ' [BALANCE DUE]';
        bannerNameElem.classList.add('patient-due-title');
    }

    let debtBadgesHTML = '';
    if (patientHasPharmacyDebt(p)) debtBadgesHTML += `<span class="patient-debt-rx">Rx</span>`;
    if (patientHasExamDebt(p)) debtBadgesHTML += `<span class="patient-debt-ex">Ex</span>`;

    bannerNameElem.innerHTML = `${p.name} ${p.nickname ? '(' + p.nickname + ')' : ''}${titleSuffix} ${debtBadgesHTML}`;
    document.getElementById('bannerNif').innerText = p.nif || 'N/A';
    document.getElementById('bannerClinicId').innerText = p.id;

    const grid = document.getElementById('demoGrid');
    if (!isEditingProfile) {
        grid.innerHTML = `
            <div class="demo-item"><label>Surnom</label><span class="readonly-val">${p.nickname || 'N/A'}</span></div>
            <div class="demo-item"><label>Sexe</label><span class="readonly-val">${p.sex ? escapeHtml(p.sex) : '<em>À renseigner</em>'}</span></div>
            <div class="demo-item"><label>Profession / Occupation</label><span class="readonly-val">${p.profession ? escapeHtml(p.profession) : '<em>À renseigner</em>'}</span></div>
            <div class="demo-item"><label>Âge / Date Naissance</label><span class="readonly-val">${p.age} ans (${p.dob || 'N/A'})</span></div>
            <div class="demo-item"><label>Lieu de Naissance</label><span class="readonly-val">${p.pob || 'N/A'}</span></div>
            <div class="demo-item"><label>Nom de la Mère</label><span class="readonly-val">${p.mother || 'N/A'}</span></div>
            <div class="demo-item"><label>Téléphone</label><span class="readonly-val">${p.phone || 'N/A'}</span></div>
            <div class="demo-item"><label>Adresse</label><span class="readonly-val">${p.address || 'N/A'}</span></div>
            <div class="demo-item"><label>Contact d'Urgence</label><span class="readonly-val">${p.eContact || 'N/A'} (${p.eRel || 'N/A'}) - ${p.ePhone || ''}</span></div>
        `;
    } else {
        grid.innerHTML = `
            <div class="demo-item"><label>ID Unique</label><input type="text" id="editClinicId" value="${p.id}"></div>
            <div class="demo-item"><label>Nom Complet</label><input type="text" id="editName" value="${p.name}"></div>
            <div class="demo-item"><label>Surnom</label><input type="text" id="editNickname" value="${p.nickname || ''}"></div>
            <div class="demo-item"><label>Sexe</label><select id="editSex"><option value="">Sélectionner...</option><option value="Féminin" ${p.sex === 'Féminin' ? 'selected' : ''}>Féminin</option><option value="Masculin" ${p.sex === 'Masculin' ? 'selected' : ''}>Masculin</option></select></div>
            <div class="demo-item"><label>Profession / Occupation</label><input type="text" id="editProfession" value="${escapeHtml(p.profession || '')}"></div>
            <div class="demo-item"><label>Date Naissance</label><input type="date" id="editDOB" value="${p.dob || ''}" onchange="calculateAgeFromEditDOB()"></div>
            <div class="demo-item"><label>Âge (Auto)</label><input type="number" id="editAge" value="${p.age}"></div>
            <div class="demo-item"><label>Lieu Naissance</label><input type="text" id="editPOB" value="${p.pob || ''}"></div>
            <div class="demo-item"><label>Nom Mère</label><input type="text" id="editMother" value="${p.mother || ''}"></div>
            <div class="demo-item"><label>NIF / NINU</label><input type="text" id="editNIF" value="${p.nif || ''}"></div>
            <div class="demo-item"><label>Téléphone</label><input type="text" id="editPhone" value="${p.phone || ''}"></div>
            <div class="demo-item"><label>Adresse</label><input type="text" id="editAddress" value="${p.address || ''}"></div>
            <div class="demo-item"><label>Contact Urgence</label><input type="text" id="editEContact" value="${p.eContact || ''}"></div>
            <div class="demo-item"><label>Lien Parenté</label><input type="text" id="editERel" value="${p.eRel || ''}"></div>
            <div class="demo-item"><label>Tél Urgence</label><input type="text" id="editEPhone" value="${p.ePhone || ''}"></div>
        `;
    }
}

function toggleEditProfile() {
    const p = patients.find(pt => pt.id === activePatientId);
    const btn = document.getElementById('editProfileBtn');
    if (isEditingProfile) {
        const newId = document.getElementById('editClinicId').value.trim();
        if (!newId) {
            alert('L\'ID clinique ne peut pas être vide.');
            return;
        }
        if (newId !== activePatientId && patients.some(pt => pt.id === newId)) {
            alert('Cet ID clinique est déjà utilisé par un autre patient.');
            return;
        }

        p.id = newId;
        activePatientId = newId;
        p.name = document.getElementById('editName').value;
        p.nickname = document.getElementById('editNickname').value;
        p.sex = document.getElementById('editSex').value;
        p.profession = document.getElementById('editProfession').value.trim();
        p.age = document.getElementById('editAge').value;
        p.dob = document.getElementById('editDOB').value;
        p.pob = document.getElementById('editPOB').value;
        p.mother = document.getElementById('editMother').value;
        p.nif = document.getElementById('editNIF').value;
        p.phone = document.getElementById('editPhone').value;
        p.address = document.getElementById('editAddress').value;
        p.eContact = document.getElementById('editEContact').value;
        p.eRel = document.getElementById('editERel').value;
        p.ePhone = document.getElementById('editEPhone').value;

        saveToStorage();
        isEditingProfile = false;
        btn.innerText = 'Modifier';
        renderDemographics(p);
    } else {
        isEditingProfile = true;
        btn.innerText = 'Enregistrer';
        renderDemographics(p);
    }
}

function deleteCurrentPatient() {
    const p = patients.find(pt => pt.id === activePatientId);
    if (!p) return;

    if (confirm(`Êtes-vous sûr de vouloir supprimer définitivement le dossier de ${p.name} ([${p.id}]) ?`)) {
        patients = patients.filter(pt => pt.id !== activePatientId);
        saveToStorage();
        isEditingProfile = false;
        showPatientRegisterSection();
    }
}

// Case Spécial / Référé / Décédé cochée ou décochée : enregistrement immédiat,
// mise à jour de la couleur du nom et de la liste des dossiers déclassés.
function onSpecialStatusChange() {
    const p = patients.find(pt => pt.id === activePatientId);
    const v = p && p.visits.find(x => x.id === activeVisitId);
    if (v) {
        v.isSpecialEvent = document.getElementById('chkSpecialEvent').checked;
        v.isReferred = document.getElementById('chkReferred').checked;
        v.isDeceased = document.getElementById('chkDeceased').checked;
        saveToStorage();
        renderGlobalDeclassedTable();
    }
    updatePatientStatusColor();
}

function updatePatientStatusColor() {
    const isDeceased = document.getElementById('chkDeceased').checked;
    const isReferred = document.getElementById('chkReferred').checked;
    const dueVal = parseFloat(document.getElementById('txtConsultDueAmount').value || 0);
    
    const bannerNameElem = document.getElementById('bannerName');
    const p = patients.find(pt => pt.id === activePatientId);

    bannerNameElem.className = '';
    let titleSuffix = '';
    if (isDeceased) {
        titleSuffix = ' [DÉCÉDÉ(E)]';
        bannerNameElem.classList.add('patient-deceased-title');
    } else if (isReferred) {
        titleSuffix = ' [RÉFÉRÉ]';
        bannerNameElem.classList.add('patient-referred-title');
    } else if (dueVal > 0) {
        titleSuffix = ' [BALANCE DUE]';
        bannerNameElem.classList.add('patient-due-title');
    }

    let debtBadgesHTML = '';
    if (patientHasPharmacyDebt(p)) debtBadgesHTML += `<span class="patient-debt-rx">Rx</span>`;
    if (patientHasExamDebt(p)) debtBadgesHTML += `<span class="patient-debt-ex">Ex</span>`;

    bannerNameElem.innerHTML = `${p.name} ${p.nickname ? '(' + p.nickname + ')' : ''}${titleSuffix} ${debtBadgesHTML}`;
}

function populatePatientSelect(selectId) {
    const sel = document.getElementById(selectId);
    const currentVal = sel.value;
    sel.innerHTML = '';
    
    patients.forEach(pt => {
        const opt = document.createElement('option');
        opt.value = pt.id;
        opt.innerText = `[${pt.id}] ${pt.name} ${pt.nickname ? '(' + pt.nickname + ')' : ''}`;
        if (pt.id === currentVal || (!currentVal && pt.id === activePatientId)) opt.selected = true;
        sel.appendChild(opt);
    });

    if (selectId === 'globalReportPatientSelect') {
        externalExamsList.forEach((ext, idx) => {
            const extOpt = document.createElement('option');
            extOpt.value = `EXT_${idx}`;
            extOpt.innerText = `[Hors-Clinique] ${ext.patientName || 'Anonyme'} (${ext.examName})`;
            if (`EXT_${idx}` === currentVal) extOpt.selected = true;
            sel.appendChild(extOpt);
        });
    }
}

function populateAdminExamPatientSelect() {
    const sel = document.getElementById('globalAdminPatientSelect');
    const currentVal = sel.value;
    sel.innerHTML = '';
    
    patients.forEach(pt => {
        const opt = document.createElement('option');
        opt.value = pt.id;
        opt.innerText = `[${pt.id}] ${pt.name} ${pt.nickname ? '(' + pt.nickname + ')' : ''}`;
        if (pt.id === currentVal || (!currentVal && pt.id === activePatientId)) opt.selected = true;
        sel.appendChild(opt);
    });

    const extOpt = document.createElement('option');
    extOpt.value = 'EXTERNAL_PATIENT';
    extOpt.innerText = 'Patient Hors-Clinique';
    if (currentVal === 'EXTERNAL_PATIENT') extOpt.selected = true;
    sel.appendChild(extOpt);

    handleAdminPatientSelectionChange();
}

function handleAdminPatientSelectionChange() {
    const selVal = document.getElementById('globalAdminPatientSelect').value;
    const extContainer = document.getElementById('externalPatientFieldsContainer');
    if (selVal === 'EXTERNAL_PATIENT') {
        extContainer.style.display = 'block';
        document.getElementById('inputExtClinicName').required = true;
        document.getElementById('inputExtClinicPhone').required = true;
    } else {
        extContainer.style.display = 'none';
        document.getElementById('inputExtClinicName').required = false;
        document.getElementById('inputExtClinicPhone').required = false;
    }
    renderAdminExams();
}

function hideAllViews() {
    document.getElementById('homeSectionView').style.display = 'none';
    document.getElementById('pharmacyDashboardView').style.display = 'none';
    document.getElementById('pharmacyStockSectionView').style.display = 'none';
    document.getElementById('pharmacyTransactionsDashboardView').style.display = 'none';
    document.getElementById('pharmacySuppliesSectionView').style.display = 'none';
    document.getElementById('pharmacyRevenuesSectionView').style.display = 'none';
    document.getElementById('patientRegisterSectionView').style.display = 'none';
    document.getElementById('consultationView').style.display = 'none';
    document.getElementById('reportsSectionView').style.display = 'none';
    document.getElementById('adminSectionView').style.display = 'none';
    stopDictation();
}

function showHomeSection() {
    hideAllViews();
    document.getElementById('homeSectionView').style.display = 'block';
}

function showConsultationSection() {
    hideAllViews();
    document.getElementById('consultationView').style.display = 'block';
}

function showPharmacyDashboard() {
    if (currentUser && currentUser.role !== 'admin') {
        alert('Accès refusé : La pharmacie est accessible uniquement aux profils administrateur.');
        return;
    }
    hideAllViews();
    document.getElementById('pharmacyDashboardView').style.display = 'block';
}

function showPharmacyStockSection() {
    hideAllViews();
    document.getElementById('pharmacyStockSectionView').style.display = 'block';
    renderPharmacyTable();
}

function showPharmacyTransactionsDashboard() {
    hideAllViews();
    document.getElementById('pharmacyTransactionsDashboardView').style.display = 'block';
}

function showPharmacySuppliesSection() {
    hideAllViews();
    document.getElementById('pharmacySuppliesSectionView').style.display = 'block';
    renderSupplyTable();
}

function showPharmacyRevenuesSection() {
    hideAllViews();
    document.getElementById('pharmacyRevenuesSectionView').style.display = 'block';
    renderRevenueTable();
}

function renderPharmacyTable() {
    const tbody = document.getElementById('pharmacyTableBody');
    const sortMode = document.getElementById('pharmacySortSelect').value;
    tbody.innerHTML = '';

    if (pharmacyInventory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">Aucun médicament enregistré en pharmacie.</td></tr>';
        return;
    }

    let sortedList = [...pharmacyInventory];
    if (sortMode === 'commercial') {
        sortedList.sort((a, b) => (a.commercialName || '').localeCompare(b.commercialName || ''));
    } else if (sortMode === 'active') {
        sortedList.sort((a, b) => (a.activeIngredient || '').localeCompare(b.activeIngredient || ''));
    } else if (sortMode === 'code') {
        sortedList.sort((a, b) => (a.pmuvCode || '').localeCompare(b.pmuvCode || ''));
    }

    sortedList.forEach((med, idx) => {
        const originalIdx = pharmacyInventory.findIndex(item => item.id === med.id);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${med.pmuvCode || 'N/A'}</strong></td>
            <td><strong>${med.commercialName || '--'}</strong></td>
            <td>${med.activeIngredient || '--'}</td>
            <td>${med.form}</td>
            <td><span style="background: var(--bg-input); padding: 2px 8px; border-radius: 4px; font-weight:600; text-transform:capitalize;">${med.unit || '--'}</span></td>
            <td>${med.qty}</td>
            <td>${med.price.toFixed(2)} HTG</td>
            <td>
                <div style="display:flex; gap:4px;">
                    <button class="btn btn-sec" style="font-size:0.75rem; padding:4px 8px;" onclick="editPharmacyItem(${originalIdx})">Modifier</button>
                    <button class="btn btn-danger" style="font-size:0.75rem; padding:4px 8px;" onclick="deletePharmacyItem(${originalIdx})">Suppr.</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function populatePmuvDropdown(selectedCode = '') {
    const select = document.getElementById('medPmuvCode');
    let codes = [...new Set(pharmacyInventory.map(item => item.pmuvCode).filter(Boolean))];
    if (!codes.includes('PMUV-MED-001')) codes.unshift('PMUV-MED-001');

    let html = '';
    codes.forEach(code => {
        html += `<option value="${code}" ${code === selectedCode ? 'selected' : ''}>${code}</option>`;
    });
    html += `<option value="AUTRE">+ Saisir un nouveau code PMUV...</option>`;
    select.innerHTML = html;
    checkNewPmuvCode(select.value);
}

function checkNewPmuvCode(val) {
    const container = document.getElementById('newPmuvCodeContainer');
    if (val === 'AUTRE') {
        container.style.display = 'block';
        document.getElementById('medNewPmuvCodeInput').required = true;
    } else {
        container.style.display = 'none';
        document.getElementById('medNewPmuvCodeInput').required = false;
    }
}

function openPharmacyAddModal() {
    document.getElementById('pharmacyModalTitle').innerText = 'Ajouter un médicament au stock';
    document.getElementById('btnSavePharmacyModal').innerText = '💾 Enregistrer';
    document.getElementById('editPharmacyIndex').value = '-1';
    
    document.getElementById('medCommercialName').value = '';
    document.getElementById('medActiveIngredient').value = '';
    document.getElementById('medForm').value = '';
    document.querySelectorAll('input[name="medUnit"]').forEach(r => r.checked = false);
    document.getElementById('medQty').value = '';
    document.getElementById('medPrice').value = '';
    document.getElementById('medNewPmuvCodeInput').value = '';

    populatePmuvDropdown();
    document.getElementById('pharmacyModal').style.display = 'flex';
}

function closePharmacyModal() {
    document.getElementById('pharmacyModal').style.display = 'none';
}

function savePharmacieItem(e) {
    e.preventDefault();
    let pmuvCode = document.getElementById('medPmuvCode').value;
    if (pmuvCode === 'AUTRE') {
        pmuvCode = document.getElementById('medNewPmuvCodeInput').value.trim();
        if (!pmuvCode) {
            alert('Veuillez saisir un code PMUV valide.');
            return;
        }
    }

    const commercialName = document.getElementById('medCommercialName').value.trim();
    const activeIngredient = document.getElementById('medActiveIngredient').value.trim();
    const form = document.getElementById('medForm').value.trim();
    const qty = parseInt(document.getElementById('medQty').value) || 0;
    const price = parseFloat(document.getElementById('medPrice').value) || 0;
    const unitSelected = document.querySelector('input[name="medUnit"]:checked');
    const unit = unitSelected ? unitSelected.value : 'comprimé/gélule';

    const editIdx = parseInt(document.getElementById('editPharmacyIndex').value);

    if (editIdx >= 0) {
        pharmacyInventory[editIdx] = { ...pharmacyInventory[editIdx], pmuvCode, commercialName, activeIngredient, form, qty, price, unit };
        alert('Médicament mis à jour avec succès !');
    } else {
        pharmacyInventory.push({ id: 'med_' + Date.now(), pmuvCode, commercialName, activeIngredient, form, unit, qty, price });
        alert('Médicament enregistré avec succès dans la pharmacie !');
    }

    saveToStorage();
    closePharmacyModal();
    renderPharmacyTable();
}

function editPharmacyItem(idx) {
    const med = pharmacyInventory[idx];
    document.getElementById('pharmacyModalTitle').innerText = 'Modifier le médicament';
    document.getElementById('btnSavePharmacyModal').innerText = '💾 Mettre à jour';
    document.getElementById('editPharmacyIndex').value = idx;

    populatePmuvDropdown(med.pmuvCode || '');
    document.getElementById('medCommercialName').value = med.commercialName || '';
    document.getElementById('medActiveIngredient').value = med.activeIngredient || '';
    document.getElementById('medForm').value = med.form || '';
    document.getElementById('medQty').value = med.qty || '';
    document.getElementById('medPrice').value = med.price || '';

    const radio = document.querySelector(`input[name="medUnit"][value="${med.unit || 'comprimé/gélule'}"]`);
    if (radio) radio.checked = true;

    document.getElementById('pharmacyModal').style.display = 'flex';
}

function deletePharmacyItem(idx) {
    if (confirm("Supprimer ce médicament du stock ?")) {
        pharmacyInventory.splice(idx, 1);
        saveToStorage();
        renderPharmacyTable();
    }
}


// --- Utilitaires fichiers (stockage local en data-URL) ---
const MAX_STORED_FILE_SIZE = 1.5 * 1024 * 1024; // 1,5 Mo

function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Erreur de lecture du fichier.'));
        reader.readAsDataURL(file);
    });
}

function dataUrlToBlob(dataUrl, type) {
    const b64 = dataUrl.split(',')[1] || '';
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: type || 'application/octet-stream' });
}

function viewStoredFile(dataUrl, type, name) {
    if (!dataUrl) { alert("Ce fichier n'a pas été conservé (enregistré avant la mise à jour)."); return; }
    const url = URL.createObjectURL(dataUrlToBlob(dataUrl, type));
    const w = window.open(url, '_blank');
    if (!w) downloadStoredFile(dataUrl, type, name);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadStoredFile(dataUrl, type, name) {
    if (!dataUrl) { alert("Ce fichier n'a pas été conservé (enregistré avant la mise à jour)."); return; }
    const url = URL.createObjectURL(dataUrlToBlob(dataUrl, type));
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Lit le fichier d'un <input type=file> : null si aucun, erreur si trop gros.
async function readInputFile(inputId) {
    const input = document.getElementById(inputId);
    const file = input && input.files && input.files[0];
    if (!file) return null;
    if (file.size > MAX_STORED_FILE_SIZE) {
        throw new Error('Fichier trop volumineux (maximum 1,5 Mo).');
    }
    return { name: file.name, type: file.type || 'application/octet-stream', dataUrl: await readFileAsDataUrl(file) };
}

function fileActionButtons(viewFn, dlFn, idx, hasFile) {
    if (!hasFile) return '<span style="color:var(--text-muted); font-size:0.75rem;">Aucun fichier</span>';
    return `<button class="btn btn-sec" style="font-size:0.72rem; padding:3px 7px; margin-right:3px;" onclick="${viewFn}(${idx})">👁️ Voir</button>` +
           `<button class="btn btn-sec" style="font-size:0.72rem; padding:3px 7px;" onclick="${dlFn}(${idx})">⬇️ Télécharger</button>`;
}

function openSupplyModal() {
    document.getElementById('supplyDateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('supplyFileInput').value = '';
    document.getElementById('supplyModal').style.display = 'flex';
}

function closeSupplyModal() {
    document.getElementById('supplyModal').style.display = 'none';
}

async function saveSupplyItem(e) {
    e.preventDefault();
    const date = document.getElementById('supplyDateInput').value;
    let file = null;
    try {
        file = await readInputFile('supplyFileInput');
    } catch (err) {
        alert(err.message);
        return;
    }

    pharmacySupplies.push({
        id: 'sup_' + Date.now(),
        date,
        fileName: file ? file.name : 'Reçu_inconnu',
        fileType: file ? file.type : '',
        fileData: file ? file.dataUrl : ''
    });
    try {
        saveToStorage();
    } catch (err) {
        pharmacySupplies.pop();
        alert("Stockage plein : impossible d'enregistrer ce reçu avec son fichier.");
        return;
    }
    closeSupplyModal();
    renderSupplyTable();
    alert('Reçu d\'approvisionnement enregistré avec succès !');
}

function renderSupplyTable() {
    const tbody = document.getElementById('supplyTableBody');
    tbody.innerHTML = '';

    if (pharmacySupplies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Aucun historique d\'approvisionnement enregistré.</td></tr>';
        return;
    }

    pharmacySupplies.forEach((sup, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(sup.date)}</strong></td>
            <td>📄 ${escapeHtml(sup.fileName)}</td>
            <td>
                ${fileActionButtons('viewSupplyFile', 'downloadSupplyFile', idx, !!sup.fileData)}
                <button class="btn btn-danger" style="font-size:0.72rem; padding:3px 7px; margin-left:3px;" onclick="deleteSupplyItem(${idx})">Suppr.</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function viewSupplyFile(idx) {
    const s = pharmacySupplies[idx];
    if (s) viewStoredFile(s.fileData, s.fileType, s.fileName);
}

function downloadSupplyFile(idx) {
    const s = pharmacySupplies[idx];
    if (s) downloadStoredFile(s.fileData, s.fileType, s.fileName);
}

function deleteSupplyItem(idx) {
    if (confirm("Supprimer cet enregistrement d'approvisionnement ?")) {
        pharmacySupplies.splice(idx, 1);
        saveToStorage();
        renderSupplyTable();
    }
}

function populateRevenueMedDropdown() {
    const select = document.getElementById('revenueMedSelect');
    select.innerHTML = '';
    if (pharmacyInventory.length === 0) {
        select.innerHTML = '<option value="">Aucun médicament en stock</option>';
        return;
    }
    pharmacyInventory.forEach(med => {
        const opt = document.createElement('option');
        opt.value = med.id;
        opt.innerText = `${med.commercialName} (${med.form}) - ${med.price.toFixed(2)} HTG [${med.unit || 'unité'}] (Stock: ${med.qty})`;
        select.appendChild(opt);
    });
}

function addRevenueMedLine() {
    const medId = document.getElementById('revenueMedSelect').value;
    const qty = parseInt(document.getElementById('revenueMedQty').value) || 1;
    if (!medId) return;

    const med = pharmacyInventory.find(m => m.id === medId);
    if (!med) return;

    currentRevenueMedLines.push({
        medId: med.id,
        name: `${med.commercialName} (${med.form})`,
        price: med.price,
        unit: med.unit || 'comprimé/gélule',
        qty: qty
    });

    renderRevenueMedLines();
}

function removeRevenueMedLine(idx) {
    currentRevenueMedLines.splice(idx, 1);
    renderRevenueMedLines();
}

function renderRevenueMedLines() {
    const tbody = document.getElementById('revenueMedLinesBody');
    tbody.innerHTML = '';
    let totalAmount = 0;

    if (currentRevenueMedLines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Aucun médicament sélectionné.</td></tr>';
        document.getElementById('revenueAmountInput').value = '0.00';
        return;
    }

    currentRevenueMedLines.forEach((line, idx) => {
        const lineTotal = line.price * line.qty;
        totalAmount += lineTotal;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${line.name}</td>
            <td>${line.qty}</td>
            <td>${line.price.toFixed(2)}</td>
            <td><span style="background: var(--bg-input); padding: 2px 6px; border-radius: 4px; font-weight:600; text-transform:capitalize;">${line.unit}</span></td>
            <td><strong>${lineTotal.toFixed(2)}</strong></td>
            <td><button type="button" class="btn btn-danger" style="font-size:0.7rem; padding:2px 6px;" onclick="removeRevenueMedLine(${idx})">X</button></td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('revenueAmountInput').value = totalAmount.toFixed(2);
}

function openRevenueModal() {
    document.getElementById('revenueDateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('revenueDescInput').value = '';
    document.getElementById('revenueFileInput').value = '';
    currentRevenueMedLines = [];
    populateRevenueMedDropdown();
    renderRevenueMedLines();
    document.getElementById('revenueModal').style.display = 'flex';
}

function closeRevenueModal() {
    document.getElementById('revenueModal').style.display = 'none';
}

async function saveRevenueItem(e) {
    e.preventDefault();
    const date = document.getElementById('revenueDateInput').value;
    const description = document.getElementById('revenueDescInput').value.trim();
    const amount = parseFloat(document.getElementById('revenueAmountInput').value) || 0;
    let file = null;
    try {
        file = await readInputFile('revenueFileInput');
    } catch (err) {
        alert(err.message);
        return;
    }

    pharmacyRevenues.push({
        id: 'rev_' + Date.now(),
        date,
        description,
        amount,
        fileName: file ? file.name : 'Aucun fichier',
        fileType: file ? file.type : '',
        fileData: file ? file.dataUrl : '',
        medLines: [...currentRevenueMedLines]
    });
    try {
        saveToStorage();
    } catch (err) {
        pharmacyRevenues.pop();
        alert("Stockage plein : impossible d'enregistrer cette recette avec son fichier.");
        return;
    }
    closeRevenueModal();
    renderRevenueTable();
    alert('Recette enregistrée avec succès !');
}

function renderRevenueTable() {
    const tbody = document.getElementById('revenueTableBody');
    tbody.innerHTML = '';

    if (pharmacyRevenues.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Aucune recette enregistrée.</td></tr>';
        return;
    }

    pharmacyRevenues.forEach((rev, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(rev.date)}</strong></td>
            <td>${escapeHtml(rev.description)}</td>
            <td>
                ${rev.fileData ? '📄 ' + escapeHtml(rev.fileName) + '<br>' : ''}
                ${fileActionButtons('viewRevenueFile', 'downloadRevenueFile', idx, !!rev.fileData)}
            </td>
            <td style="color: var(--primary-green); font-weight: bold;">${(rev.amount || 0).toFixed(2)} HTG</td>
            <td>
                <button class="btn btn-sec" style="font-size:0.75rem; padding:3px 8px; margin-right:3px;" onclick="printRevenue(${idx})">🖨️ Imprimer</button>
                <button class="btn btn-danger" style="font-size:0.75rem; padding:3px 8px;" onclick="deleteRevenueItem(${idx})">Suppr.</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function viewRevenueFile(idx) {
    const r = pharmacyRevenues[idx];
    if (r) viewStoredFile(r.fileData, r.fileType, r.fileName);
}

function downloadRevenueFile(idx) {
    const r = pharmacyRevenues[idx];
    if (r) downloadStoredFile(r.fileData, r.fileType, r.fileName);
}

function deleteRevenueItem(idx) {
    if (confirm("Supprimer cette entrée de recette ?")) {
        pharmacyRevenues.splice(idx, 1);
        saveToStorage();
        renderRevenueTable();
    }
}

function showPatientRegisterSection() {
    hideAllViews();
    document.getElementById('patientRegisterSectionView').style.display = 'block';
    renderPatientRegisterTable();
}

function renderPatientRegisterTable() {
    const tbody = document.getElementById('patientRegisterTableBody');
    const counterBadge = document.getElementById('patientCounterBadge');
    const sortMode = document.getElementById('patientSortSelect').value;

    counterBadge.innerText = `${patients.length} patient(s)`;
    tbody.innerHTML = '';

    if (patients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Aucun patient enregistré dans la base de données.</td></tr>';
        return;
    }

    let sortedPatients = [...patients];
    if (sortMode === 'alpha') {
        sortedPatients.sort((a, b) => a.name.localeCompare(b.name));
    } else {
        sortedPatients.sort((a, b) => a.id.localeCompare(b.id));
    }

    sortedPatients.forEach(pt => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${pt.id}</strong></td>
            <td>${pt.name} ${pt.nickname ? '(' + pt.nickname + ')' : ''}</td>
            <td>${pt.nif || 'N/A'}</td>
            <td>${pt.phone || 'N/A'}</td>
            <td>
                <button class="btn btn-green" style="font-size:0.75rem; padding:4px 10px;" onclick="selectPatient('${pt.id}')">📂 Ouvrir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function showReportsSection() {
    if (currentUser && currentUser.role === 'reception') {
        alert('Accès refusé : Réservé aux administrateurs et médecins.');
        return;
    }
    hideAllViews();
    document.getElementById('reportsSectionView').style.display = 'block';
    populatePatientSelect('globalReportPatientSelect');
    toggleReportMode();
}

function showAdminSection() {
    if (currentUser && currentUser.role !== 'admin') {
        alert('Accès refusé : Réservé aux administrateurs.');
        return;
    }
    hideAllViews();
    document.getElementById('adminSectionView').style.display = 'block';
    showAdminDashboardCards();
    populateAdminExamPatientSelect();
    renderAdminView();
}

// --- PIN administrateur (Finance + Gestion des utilisateurs) ---
let pinActionType = 'finance';

function openPinModal(actionType) {
    pinActionType = actionType;
    document.getElementById('pinInput').value = '';
    document.getElementById('pinModal').style.display = 'flex';
    document.getElementById('pinInput').focus();
}

function promptPinForFinance() { openPinModal('finance'); }
function promptPinForUserManagement() { openPinModal('userManagement'); }

function closePinModal() {
    document.getElementById('pinModal').style.display = 'none';
}

function verifyPinAction() {
    const inputPin = document.getElementById('pinInput').value;
    if (inputPin !== FINANCE_PIN) {
        alert('Code PIN incorrect.');
        return;
    }
    closePinModal();
    if (pinActionType === 'userManagement') {
        showUserManagementModal();
    } else {
        switchAdminTab('tabFinance');
    }
}

// Ancien nom conservé par compatibilité
function verifyFinancePin() { verifyPinAction(); }

function openChangePinModal() {
    toggleOtherFunctionsMenu();
    document.getElementById('oldPinInput').value = '';
    document.getElementById('newPinInput').value = '';
    document.getElementById('changePinModal').style.display = 'flex';
}

function closeChangePinModal() {
    document.getElementById('changePinModal').style.display = 'none';
}

function saveNewPin(e) {
    e.preventDefault();
    const oldPin = document.getElementById('oldPinInput').value;
    const newPin = document.getElementById('newPinInput').value.trim();

    if (oldPin !== FINANCE_PIN) {
        alert('Ancien code PIN incorrect.');
        return;
    }
    if (!newPin) {
        alert('Veuillez saisir un nouveau code PIN valide.');
        return;
    }

    FINANCE_PIN = newPin;
    localStorage.setItem('clinic_finance_pin', FINANCE_PIN);
    closeChangePinModal();
    alert('Code PIN modifié avec succès !');
}

function toggleOtherFunctionsMenu() {
    const menu = document.getElementById('otherFunctionsMenu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function resetFinancialCounters() {
    toggleOtherFunctionsMenu();
    if (confirm("⚠️ ATTENTION : Voulez-vous ré-initialiser les compteurs de recettes à zéro ? L'historique des recouvrements sera conservé.")) {
        lastResetTimestamp = getCurrentDateTimeInUTC5ISO();

        patients.forEach(pt => {
            pt.visits.forEach(vst => {
                vst.consultPaidPart = 0;
                vst.consultDueAmount = 0;
                if (vst.adminExamsList) {
                    vst.adminExamsList.forEach(ex => {
                        ex.montantVerse = 0;
                        ex.montantDette = 0;
                    });
                }
            });
        });
        externalExamsList.forEach(ext => {
            ext.priceRequired = 0;
            ext.balanceDue = 0;
        });
        pharmacyRevenues = [];

        saveToStorage();
        renderGlobalFinance();
        alert('Tous les compteurs ont été remis à zéro avec succès (l\'historique des recouvrements a été préservé).');
    }
}

function showAdminDashboardCards() {
    document.getElementById('adminDashboardCards').style.display = 'grid';
    document.getElementById('backToAdminDashboardContainer').style.display = 'none';
    document.querySelectorAll('.admin-sub-content').forEach(c => c.style.display = 'none');
}

function switchAdminTab(tabId) {
    document.getElementById('adminDashboardCards').style.display = 'none';
    document.getElementById('backToAdminDashboardContainer').style.display = 'block';
    document.querySelectorAll('.admin-sub-content').forEach(c => c.style.display = 'none');
    document.getElementById(tabId).style.display = 'block';

    if (tabId === 'tabExams') populateAdminExamPatientSelect();
    if (tabId === 'tabExternalExams') renderAdminExternalExams();
    if (tabId === 'tabDeclassed') renderGlobalDeclassedTable();
    if (tabId === 'tabFinance') renderGlobalFinance();
}

function renderVisitsDropdown(p) {
    const dropdown = document.getElementById('visitDropdown');
    dropdown.innerHTML = '';
    p.visits.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        const readableDate = v.dateTime ? formatISOToReadable(v.dateTime) : (v.date || '--');
        const dueVal = parseFloat(v.consultDueAmount || 0);
        opt.innerText = `${readableDate} ${v.isDeceased ? '💀 [Décédé]' : (v.isReferred ? '🟠 [Référé]' : (dueVal > 0 ? '🟣 [Balance Due]' : '📋 [Visite]'))}`;
        if (v.id === activeVisitId) opt.selected = true;
        dropdown.appendChild(opt);
    });
}

function switchVisit(vId) {
    stopDictation();
    activeVisitId = vId;
    const p = patients.find(pt => pt.id === activePatientId);
    const v = p.visits.find(vst => vst.id === vId);
    renderVisitsDropdown(p);

    document.getElementById('visitDateTimeInput').value = v.dateTime || getCurrentDateTimeInUTC5ISO();

    document.getElementById('txtConsultationReason').value = v.consultationReason || '';
    document.getElementById('vHeight').value = v.height || '';
    document.getElementById('vWeight').value = v.weight || '';
    document.getElementById('vBP').value = v.bp || '';
    document.getElementById('vHR').value = v.hr || '';
    document.getElementById('vTemp').value = v.temp || '';
    document.getElementById('vFR').value = v.fr || '';
    document.getElementById('vSpO2').value = v.spo2 || '';
    document.getElementById('vGlyc').value = v.glyc || '';
    document.getElementById('txtHPI').value = v.hpi || '';
    document.getElementById('txtLabResults').value = v.labResults || '';
    document.getElementById('txtEKGResults').value = v.ekgResults || '';
    document.getElementById('txtSonoResults').value = v.sonoResults || '';
    document.getElementById('txtImagingResults').value = v.imagingResults || '';
    document.getElementById('txtAssessment').value = v.assessment || '';
    document.getElementById('txtPlan').value = v.plan || '';
    document.getElementById('docName').value = v.docName || '';
    
    document.getElementById('chkSpecialEvent').checked = !!v.isSpecialEvent;
    document.getElementById('chkReferred').checked = !!v.isReferred;
    document.getElementById('chkDeceased').checked = !!v.isDeceased;
    
    document.getElementById('txtConsultPaidPart').value = v.consultPaidPart !== undefined ? v.consultPaidPart : '';
    document.getElementById('txtConsultDueAmount').value = v.consultDueAmount !== undefined ? v.consultDueAmount : '';
    document.getElementById('txtSpecialDetails').value = v.specialDetails || '';

    calculateBMI();

    document.querySelectorAll('#rosContainer input').forEach(cb => {
        cb.checked = v.ros ? v.ros.includes(cb.value) : false;
    });

    updatePatientStatusColor();
    collapseExamSectionByDefault();
}

function saveCurrentVisit() {
    stopDictation();
    const p = patients.find(pt => pt.id === activePatientId);
    const v = p.visits.find(vst => vst.id === activeVisitId);

    const paidPartVal = parseFloat(document.getElementById('txtConsultPaidPart').value) || 0;
    const dueAmountVal = parseFloat(document.getElementById('txtConsultDueAmount').value) || 0;

    if (isNaN(paidPartVal) || paidPartVal < 0) {
        alert('Veuillez saisir des frais de consultation versés valides.');
        return;
    }
    if (isNaN(dueAmountVal) || dueAmountVal < 0) {
        alert('Veuillez saisir une valeur due valide.');
        return;
    }

    v.dateTime = document.getElementById('visitDateTimeInput').value || getCurrentDateTimeInUTC5ISO();
    v.consultationReason = document.getElementById('txtConsultationReason').value;
    v.height = document.getElementById('vHeight').value;
    v.weight = document.getElementById('vWeight').value;
    v.bp = document.getElementById('vBP').value;
    v.hr = document.getElementById('vHR').value;
    v.temp = document.getElementById('vTemp').value;
    v.fr = document.getElementById('vFR').value;
    v.spo2 = document.getElementById('vSpO2').value;
    v.glyc = document.getElementById('vGlyc').value;
    v.hpi = document.getElementById('txtHPI').value;
    v.labResults = document.getElementById('txtLabResults').value;
    v.ekgResults = document.getElementById('txtEKGResults').value;
    v.sonoResults = document.getElementById('txtSonoResults').value;
    v.imagingResults = document.getElementById('txtImagingResults').value;
    v.assessment = document.getElementById('txtAssessment').value;
    v.plan = document.getElementById('txtPlan').value;
    v.docName = document.getElementById('docName').value;
    v.ros = Array.from(document.querySelectorAll('#rosContainer input:checked')).map(cb => cb.value);

    v.isSpecialEvent = document.getElementById('chkSpecialEvent').checked;
    v.isReferred = document.getElementById('chkReferred').checked;
    v.isDeceased = document.getElementById('chkDeceased').checked;
    
    v.consultPaidPart = paidPartVal;
    v.consultDueAmount = dueAmountVal;
    v.specialDetails = document.getElementById('txtSpecialDetails').value;

    saveToStorage();
    renderVisitsDropdown(p);
    renderDemographics(p);

    alert('Consultation enregistrée avec succès !');
}

function renderAdminView() {
    renderAdminExams();
    renderAdminExternalExams();
    renderGlobalDeclassedTable();
    renderGlobalFinance();
}

function renderAdminExams() {
    const selectedVal = document.getElementById('globalAdminPatientSelect').value;
    const savedListBody = document.getElementById('savedAdminExamsListBody');
    savedListBody.innerHTML = '';

    if (selectedVal === 'EXTERNAL_PATIENT') {
        if (externalExamsList.length === 0) {
            savedListBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Aucun examen hors-clinique enregistré.</td></tr>';
            return;
        }
        externalExamsList.forEach((ex, idx) => {
            let montantVerse = parseFloat(ex.priceRequired || 0);
            let montantDette = parseFloat(ex.balanceDue || 0);
            let hasBalanceDue = montantDette > 0;
            let rowColorStyle = hasBalanceDue ? 'color: var(--danger-red); font-weight: bold;' : 'color: var(--primary-green); font-weight: bold;';

            const savedTr = document.createElement('tr');
            savedTr.innerHTML = `
                <td style="${rowColorStyle}">${ex.patientName || 'Anonyme'} (${ex.patientPhone || 'N/A'})</td>
                <td style="${rowColorStyle}">${ex.examName}</td>
                <td style="${rowColorStyle}">${hasBalanceDue ? 'Balance due' : 'Payé'}</td>
                <td style="${rowColorStyle}">${montantVerse.toFixed(2)} HTG</td>
                <td style="${rowColorStyle}">${montantDette.toFixed(2)} HTG</td>
                <td style="${rowColorStyle}">${ex.deliveryStatus} (${ex.examDate || 'N/A'})</td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="btn btn-sec" style="font-size:0.75rem; padding:4px 8px;" onclick="editExternalExamRow(${idx})">Modifier</button>
                        <button class="btn btn-danger" style="font-size:0.75rem; padding:4px 8px;" onclick="removeExternalExamRow(${idx})">Supprimer</button>
                    </div>
                </td>
            `;
            savedListBody.appendChild(savedTr);
        });
    } else {
        const selectedPatientId = selectedVal || activePatientId;
        const p = patients.find(pt => pt.id === selectedPatientId);
        
        if (!p || !p.visits || p.visits.length === 0) {
            savedListBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Aucune visite trouvée.</td></tr>';
            return;
        }

        const currentV = p.visits[p.visits.length - 1];
        if (!currentV.adminExamsList) currentV.adminExamsList = [];

        if (currentV.adminExamsList.length === 0) {
            savedListBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Aucun examen enregistré.</td></tr>';
            return;
        }

        currentV.adminExamsList.forEach((ex, idx) => {
            let montantVerse = ex.montantVerse !== undefined ? parseFloat(ex.montantVerse || 0) : parseFloat(ex.amount || 0);
            let montantDette = ex.montantDette !== undefined ? parseFloat(ex.montantDette || 0) : (ex.status === 'Balance due' ? parseFloat(ex.amount || 0) : 0);
            
            let hasBalanceDue = montantDette > 0;
            let rowColorStyle = hasBalanceDue ? 'color: var(--danger-red); font-weight: bold;' : 'color: var(--primary-green); font-weight: bold;';

            const savedTr = document.createElement('tr');
            savedTr.innerHTML = `
                <td style="${rowColorStyle}">[${p.id}] ${p.name}</td>
                <td style="${rowColorStyle}">${ex.examName}</td>
                <td style="${rowColorStyle}">${ex.status}</td>
                <td style="${rowColorStyle}">${montantVerse.toFixed(2)} HTG</td>
                <td style="${rowColorStyle}">${montantDette.toFixed(2)} HTG</td>
                <td style="${rowColorStyle}">${ex.deliveryStatus} (${ex.deliveryDate || 'N/A'})</td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="btn btn-sec" style="font-size:0.75rem; padding:4px 8px;" onclick="editClinicExamRow(${idx})">Modifier</button>
                        <button class="btn btn-danger" style="font-size:0.75rem; padding:4px 8px;" onclick="removeAdminExamRow(${idx})">Supprimer</button>
                    </div>
                </td>
            `;
            savedListBody.appendChild(savedTr);
        });
    }
}

function saveNewClinicExamRow() {
    const selectedVal = document.getElementById('globalAdminPatientSelect').value;
    const examName = document.getElementById('inputClinicExamName').value;
    const status = document.getElementById('inputClinicExamStatus').value;
    const montantVerse = parseFloat(document.getElementById('inputClinicExamAmount').value) || 0;
    const montantDette = parseFloat(document.getElementById('inputClinicExamDebt').value) || 0;
    const deliveryStatus = document.getElementById('inputClinicExamDelivery').value;
    const deliveryDate = document.getElementById('inputClinicExamDate').value;

    if (montantDette > 0 && deliveryStatus === 'Livré') {
        alert('Erreur : Impossible de définir le statut sur "Livré" tant qu\'une dette est enregistrée !');
        return;
    }

    if (selectedVal === 'EXTERNAL_PATIENT') {
        const patientName = document.getElementById('inputExtClinicName').value.trim();
        const patientPhone = document.getElementById('inputExtClinicPhone').value.trim();

        if (!patientName || !patientPhone) {
            alert('Veuillez renseigner le Nom & Prénom et le Numéro de téléphone du patient hors-clinique.');
            return;
        }

        const editIndex = parseInt(document.getElementById('editClinicIndex').value);
        if (editIndex >= 0) {
            externalExamsList[editIndex] = {
                patientName,
                patientPhone,
                examName,
                priceRequired: montantVerse,
                balanceDue: montantDette,
                deliveryStatus,
                examDate: deliveryDate
            };
            cancelEditClinicExam();
            alert('Examen hors-clinique modifié avec succès !');
        } else {
            externalExamsList.push({
                patientName,
                patientPhone,
                examName,
                priceRequired: montantVerse,
                balanceDue: montantDette,
                deliveryStatus,
                examDate: deliveryDate
            });
            document.getElementById('inputExtClinicName').value = '';
            document.getElementById('inputExtClinicPhone').value = '';
            document.getElementById('inputClinicExamAmount').value = '';
            document.getElementById('inputClinicExamDebt').value = '';
            document.getElementById('inputClinicExamDate').value = '';
            alert('Examen hors-clinique enregistré !');
        }
    } else {
        const selectedPatientId = selectedVal || activePatientId;
        const p = patients.find(pt => pt.id === selectedPatientId);
        if (!p || p.visits.length === 0) return;

        const currentV = p.visits[p.visits.length - 1];
        if (!currentV.adminExamsList) currentV.adminExamsList = [];

        const editIndex = parseInt(document.getElementById('editClinicIndex').value);

        if (editIndex >= 0) {
            currentV.adminExamsList[editIndex] = { examName, status, montantVerse, montantDette, deliveryStatus, deliveryDate };
            cancelEditClinicExam();
            alert('Examen modifié avec succès !');
        } else {
            currentV.adminExamsList.push({ examName, status, montantVerse, montantDette, deliveryStatus, deliveryDate });
            document.getElementById('inputClinicExamAmount').value = '';
            document.getElementById('inputClinicExamDebt').value = '';
            document.getElementById('inputClinicExamDate').value = '';
            document.getElementById('inputClinicExamStatus').value = 'Payé';
            document.getElementById('inputClinicExamDelivery').value = 'En attente';
            alert('Examen enregistré !');
        }
        if (activePatientId) renderDemographics(patients.find(pt => pt.id === activePatientId));
    }

    saveToStorage();
    renderAdminExams();
}

function editClinicExamRow(idx) {
    const selectedVal = document.getElementById('globalAdminPatientSelect').value;
    if (selectedVal === 'EXTERNAL_PATIENT') {
        const ex = externalExamsList[idx];
        document.getElementById('inputExtClinicName').value = ex.patientName || '';
        document.getElementById('inputExtClinicPhone').value = ex.patientPhone || '';
        document.getElementById('inputClinicExamName').value = ex.examName;
        document.getElementById('inputClinicExamStatus').value = parseFloat(ex.balanceDue || 0) > 0 ? 'Balance due' : 'Payé';
        document.getElementById('inputClinicExamAmount').value = ex.priceRequired || '';
        document.getElementById('inputClinicExamDebt').value = ex.balanceDue || '';
        document.getElementById('inputClinicExamDelivery').value = ex.deliveryStatus;
        document.getElementById('inputClinicExamDate').value = ex.examDate || '';

        document.getElementById('editClinicIndex').value = idx;
        document.getElementById('formClinicTitle').innerText = 'Modifier l\'examen hors-clinique';
        document.getElementById('btnSaveClinicExam').innerText = '💾 Mettre à jour';
        document.getElementById('btnCancelClinicExam').style.display = 'inline-block';
    } else {
        const selectedPatientId = selectedVal || activePatientId;
        const p = patients.find(pt => pt.id === selectedPatientId);
        if (!p || p.visits.length === 0) return;
        const currentV = p.visits[p.visits.length - 1];
        const ex = currentV.adminExamsList[idx];

        let montantVerse = ex.montantVerse !== undefined ? ex.montantVerse : (ex.amount || 0);
        let montantDette = ex.montantDette !== undefined ? ex.montantDette : (ex.status === 'Balance due' ? (ex.amount || 0) : 0);

        document.getElementById('inputClinicExamName').value = ex.examName;
        document.getElementById('inputClinicExamStatus').value = ex.status;
        document.getElementById('inputClinicExamAmount').value = montantVerse || '';
        document.getElementById('inputClinicExamDebt').value = montantDette || '';
        document.getElementById('inputClinicExamDelivery').value = ex.deliveryStatus;
        document.getElementById('inputClinicExamDate').value = ex.deliveryDate || '';
        
        document.getElementById('editClinicIndex').value = idx;
        document.getElementById('formClinicTitle').innerText = 'Modifier l\'examen sélectionné';
        document.getElementById('btnSaveClinicExam').innerText = '💾 Mettre à jour';
        document.getElementById('btnCancelClinicExam').style.display = 'inline-block';
    }
}

// Boutons de la liste « Patient Hors-Clinique » (onglet Examens cliniques)
function editExternalExamRow(idx) { editClinicExamRow(idx); }
function removeExternalExamRow(idx) { removeAdminExamRow(idx); }

function cancelEditClinicExam() {
    document.getElementById('editClinicIndex').value = '-1';
    document.getElementById('formClinicTitle').innerText = 'Ajouter un nouvel examen';
    document.getElementById('btnSaveClinicExam').innerText = '💾 Enregistrer';
    document.getElementById('btnCancelClinicExam').style.display = 'none';

    document.getElementById('inputExtClinicName').value = '';
    document.getElementById('inputExtClinicPhone').value = '';
    document.getElementById('inputClinicExamAmount').value = '';
    document.getElementById('inputClinicExamDebt').value = '';
    document.getElementById('inputClinicExamDate').value = '';
    document.getElementById('inputClinicExamStatus').value = 'Payé';
    document.getElementById('inputClinicExamDelivery').value = 'En attente';
}

function removeAdminExamRow(index) {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet examen ?")) {
        const selectedVal = document.getElementById('globalAdminPatientSelect').value;
        if (selectedVal === 'EXTERNAL_PATIENT') {
            externalExamsList.splice(index, 1);
        } else {
            const selectedPatientId = selectedVal || activePatientId;
            const p = patients.find(pt => pt.id === selectedPatientId);
            if (!p || p.visits.length === 0) return;
            const currentV = p.visits[p.visits.length - 1];
            currentV.adminExamsList.splice(index, 1);
            if (activePatientId) renderDemographics(patients.find(pt => pt.id === activePatientId));
        }
        saveToStorage();
        renderAdminExams();
    }
}

function renderAdminExternalExams() {
    const savedListBody = document.getElementById('savedExternalExamsListBody');
    savedListBody.innerHTML = '';

    if (externalExamsList.length === 0) {
        savedListBody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">Aucun patient hors-clinique enregistré.</td></tr>';
        return;
    }

    externalExamsList.forEach((ex, idx) => {
        let hasBalanceDue = (parseFloat(ex.balanceDue) > 0);
        let rowColorStyle = hasBalanceDue ? 'color: var(--danger-red); font-weight: bold;' : 'color: var(--primary-green); font-weight: bold;';

        const savedTr = document.createElement('tr');
        savedTr.innerHTML = `
            <td style="${rowColorStyle}">${ex.patientName || 'Non spécifié'}</td>
            <td style="${rowColorStyle}">${ex.patientPhone || 'N/A'}</td>
            <td style="${rowColorStyle}">${ex.examName}</td>
            <td style="${rowColorStyle}">${parseFloat(ex.priceRequired || 0).toFixed(2)} HTG</td>
            <td style="${rowColorStyle}">${parseFloat(ex.balanceDue || 0).toFixed(2)} HTG</td>
            <td style="${rowColorStyle}">${ex.deliveryStatus}</td>
            <td style="${rowColorStyle}">${ex.examDate || 'N/A'}</td>
            <td>
                <div style="display:flex; gap:4px;">
                    <button class="btn btn-sec" style="font-size:0.75rem; padding:4px 8px;" onclick="editExternalExamRowTab(${idx})">Modifier</button>
                    <button class="btn btn-danger" style="font-size:0.75rem; padding:4px 8px;" onclick="removeExternalExamRowTab(${idx})">Supprimer</button>
                </div>
            </td>
        `;
        savedListBody.appendChild(savedTr);
    });
}

function saveNewExternalExamRow() {
    const patientName = document.getElementById('inputExtName').value.trim();
    const patientPhone = document.getElementById('inputExtPhone').value.trim();
    const examName = document.getElementById('inputExtExam').value;
    const priceRequired = parseFloat(document.getElementById('inputExtPrice').value) || 0;
    const balanceDue = parseFloat(document.getElementById('inputExtBalance').value) || 0;
    const deliveryStatus = document.getElementById('inputExtDelivery').value;
    const examDate = document.getElementById('inputExtDate').value;

    if (balanceDue > 0 && deliveryStatus === 'Livré') {
        alert('Erreur : Impossible de définir le statut sur "Livré" tant qu\'une balance est due !');
        return;
    }

    const editIndex = parseInt(document.getElementById('editExtIndex').value);

    if (editIndex >= 0) {
        externalExamsList[editIndex] = { patientName, patientPhone, examName, priceRequired, balanceDue, deliveryStatus, examDate };
        cancelEditExtExam();
        alert('Patient hors-clinique modifié avec succès !');
    } else {
        externalExamsList.push({ patientName, patientPhone, examName, priceRequired, balanceDue, deliveryStatus, examDate });
        document.getElementById('inputExtName').value = '';
        document.getElementById('inputExtPhone').value = '';
        document.getElementById('inputExtPrice').value = '';
        document.getElementById('inputExtBalance').value = '';
        document.getElementById('inputExtDate').value = '';
        document.getElementById('inputExtDelivery').value = 'En attente';
        alert('Patient hors-clinique enregistré !');
    }

    saveToStorage();
    renderAdminExternalExams();
    if (activePatientId) renderDemographics(patients.find(pt => pt.id === activePatientId));
}

function editExternalExamRowTab(idx) {
    const ex = externalExamsList[idx];

    document.getElementById('inputExtName').value = ex.patientName || '';
    document.getElementById('inputExtPhone').value = ex.patientPhone || '';
    document.getElementById('inputExtExam').value = ex.examName;
    document.getElementById('inputExtPrice').value = ex.priceRequired || '';
    document.getElementById('inputExtBalance').value = ex.balanceDue || '';
    document.getElementById('inputExtDelivery').value = ex.deliveryStatus;
    document.getElementById('inputExtDate').value = ex.examDate || '';

    document.getElementById('editExtIndex').value = idx;
    document.getElementById('formExtTitle').innerText = 'Modifier le patient hors-clinique sélectionné';
    document.getElementById('btnSaveExtExam').innerText = '💾 Mettre à jour';
    document.getElementById('btnCancelExtExam').style.display = 'inline-block';
}

function cancelEditExtExam() {
    document.getElementById('editExtIndex').value = '-1';
    document.getElementById('formExtTitle').innerText = 'Ajouter un patient hors-clinique';
    document.getElementById('btnSaveExtExam').innerText = '💾 Enregistrer';
    document.getElementById('btnCancelExtExam').style.display = 'none';

    document.getElementById('inputExtName').value = '';
    document.getElementById('inputExtPhone').value = '';
    document.getElementById('inputExtPrice').value = '';
    document.getElementById('inputExtBalance').value = '';
    document.getElementById('inputExtDate').value = '';
    document.getElementById('inputExtDelivery').value = 'En attente';
}

function removeExternalExamRowTab(index) {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet examen hors-clinique ?")) {
        externalExamsList.splice(index, 1);
        saveToStorage();
        renderAdminExternalExams();
        if (activePatientId) renderDemographics(patients.find(pt => pt.id === activePatientId));
    }
}

function openCustomExamModal() {
    document.getElementById('customExamNameInput').value = '';
    document.getElementById('customExamModal').style.display = 'flex';
}

function closeCustomExamModal() {
    document.getElementById('customExamModal').style.display = 'none';
}

function saveCustomExam() {
    const val = document.getElementById('customExamNameInput').value.trim();
    if (val) {
        if (!clinicExamTypes.includes(val)) {
            clinicExamTypes.push(val);
            alert(`Examen "${val}" ajouté à la liste.`);
            closeCustomExamModal();
            populateExamDropdowns();
        } else {
            alert('Cet examen existe déjà.');
        }
    }
}

function renderGlobalDeclassedTable() {
    const declassedTbody = document.getElementById('adminDeclassedTableBody');
    declassedTbody.innerHTML = '';
    let count = 0;

    patients.forEach(pt => {
        const lastV = pt.visits && pt.visits.length > 0 ? pt.visits[pt.visits.length - 1] : null;
        if (lastV && (lastV.isDeceased || lastV.isReferred)) {
            count++;
            const tr = document.createElement('tr');
            let statusBadge = lastV.isDeceased ? '<span style="color:var(--danger-red); font-weight:bold;">💀 Décédé(e)</span>' : '<span style="color:var(--warning-orange); font-weight:bold;">🟠 Référé(e)</span>';
            const readableDate = lastV.dateTime ? formatISOToReadable(lastV.dateTime) : (lastV.date || '--');
            tr.innerHTML = `
                <td><strong>[${pt.id}]</strong> ${pt.name} ${pt.nickname ? '(' + pt.nickname + ')' : ''}</td>
                <td>${pt.nif || 'N/A'}</td>
                <td>${statusBadge}</td>
                <td>${readableDate}</td>
                <td>${lastV.specialDetails || 'Aucune observation.'}</td>
                <td><button class="btn btn-sec" style="font-size:0.75rem; padding:4px 8px;" onclick="openPatientFromAdmin('${pt.id}')">📂 Ouvrir</button></td>
            `;
            declassedTbody.appendChild(tr);
        }
    });

    if (count === 0) {
        declassedTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Aucun dossier déclassé.</td></tr>';
    }
}

function openPatientFromAdmin(patientId) {
    selectPatient(patientId);
}

function renderGlobalFinance() {
    let consultTotal = 0;
    let examsTotal = 0;
    let recoveriesTotal = 0;

    patients.forEach(pt => {
        pt.visits.forEach(vst => {
            if (!lastResetTimestamp || (vst.dateTime && vst.dateTime >= lastResetTimestamp)) {
                let paidPart = vst.consultPaidPart !== undefined ? parseFloat(vst.consultPaidPart || 0) : 0;
                if (paidPart > 0) consultTotal += paidPart;

                if (vst.adminExamsList) {
                    vst.adminExamsList.forEach(ex => {
                        let montantVerse = ex.montantVerse !== undefined ? parseFloat(ex.montantVerse || 0) : parseFloat(ex.amount || 0);
                        if (montantVerse > 0) examsTotal += montantVerse;
                    });
                }
            }
        });

        if (pt.recoveryHistory) {
            pt.recoveryHistory.forEach(rec => {
                if (!lastResetTimestamp || rec.dateTime >= lastResetTimestamp) {
                    recoveriesTotal += parseFloat(rec.paidAmount) || 0;
                }
            });
        }
    });

    externalExamsList.forEach(ext => {
        if (ext.priceRequired) {
            examsTotal += parseFloat(ext.priceRequired) || 0;
        }
        if (ext.recoveryHistory) {
            ext.recoveryHistory.forEach(rec => {
                if (!lastResetTimestamp || rec.dateTime >= lastResetTimestamp) {
                    recoveriesTotal += parseFloat(rec.paidAmount) || 0;
                }
            });
        }
    });

    const grandTotal = consultTotal + examsTotal;
    const nowTs = `Dernière mise à jour : ${getCurrentDateTimeFormatted()}`;

    document.getElementById('finConsultTotal').innerText = `${consultTotal.toFixed(2)} HTG`;
    document.getElementById('tsConsult').innerText = nowTs;

    document.getElementById('finExamsTotal').innerText = `${examsTotal.toFixed(2)} HTG`;
    document.getElementById('tsExams').innerText = nowTs;

    document.getElementById('finGrandTotal').innerText = `${grandTotal.toFixed(2)} HTG`;
    document.getElementById('tsGrandTotal').innerText = nowTs;

    document.getElementById('finRecoveriesTotal').innerText = `${recoveriesTotal.toFixed(2)} HTG`;
}

function openFinanceDetailModal(type) {
    const titleElem = document.getElementById('financeDetailModalTitle');
    const subtitleElem = document.getElementById('financeDetailModalSubtitle');
    const headerElem = document.getElementById('financeDetailTableHeader');
    const tbody = document.getElementById('financeDetailTableBody');
    tbody.innerHTML = '';

    let detailsList = [];
    let totalVal = 0;

    if (type === 'consult') {
        titleElem.innerText = 'Détail - Compteur Consultation';
        headerElem.innerHTML = `<tr><th>Patient</th><th>Visite / Date</th><th>Frais de Consultation Versés</th></tr>`;
        
        patients.forEach(pt => {
            pt.visits.forEach(vst => {
                if (!lastResetTimestamp || (vst.dateTime && vst.dateTime >= lastResetTimestamp)) {
                    let paidPart = parseFloat(vst.consultPaidPart || 0);
                    if (paidPart > 0) {
                        totalVal += paidPart;
                        detailsList.push({
                            name: `[${pt.id}] ${pt.name}`,
                            info: `Visite du ${formatISOToReadable(vst.dateTime)}`,
                            amount: paidPart
                        });
                    }
                }
            });
        });

        subtitleElem.innerText = `Total cumulé des frais de consultation : ${totalVal.toFixed(2)} HTG`;
        if (detailsList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Aucune opération enregistrée.</td></tr>`;
        } else {
            detailsList.forEach(item => {
                tbody.innerHTML += `<tr><td><strong>${item.name}</strong></td><td>${item.info}</td><td style="color:var(--primary-green); font-weight:bold;">${item.amount.toFixed(2)} HTG</td></tr>`;
            });
        }

    } else if (type === 'exam') {
        titleElem.innerText = 'Détail - Compteur Examen (Clinique & Hors-Clinique)';
        headerElem.innerHTML = `<tr><th>Patient / Nom</th><th>Type d'Examen & Date</th><th>Montant Versé</th></tr>`;

        patients.forEach(pt => {
            pt.visits.forEach(vst => {
                if (!lastResetTimestamp || (vst.dateTime && vst.dateTime >= lastResetTimestamp)) {
                    if (vst.adminExamsList) {
                        vst.adminExamsList.forEach(ex => {
                            let montantVerse = parseFloat(ex.montantVerse || ex.amount || 0);
                            if (montantVerse > 0) {
                                totalVal += montantVerse;
                                detailsList.push({
                                    name: `[${pt.id}] ${pt.name}`,
                                    info: `${ex.examName} (${formatISOToReadable(vst.dateTime)})`,
                                    amount: montantVerse
                                });
                            }
                        });
                    }
                }
            });
        });

        externalExamsList.forEach(ext => {
            let montantVerse = parseFloat(ext.priceRequired || 0);
            if (montantVerse > 0) {
                totalVal += montantVerse;
                detailsList.push({
                    name: ext.patientName || 'Hors-Clinique',
                    info: `${ext.examName} (${ext.examDate || 'N/A'})`,
                    amount: montantVerse
                });
            }
        });

        subtitleElem.innerText = `Total cumulé des examens : ${totalVal.toFixed(2)} HTG`;
        if (detailsList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Aucune opération enregistrée.</td></tr>`;
        } else {
            detailsList.forEach(item => {
                tbody.innerHTML += `<tr><td><strong>${item.name}</strong></td><td>${item.info}</td><td style="color:var(--primary-green); font-weight:bold;">${item.amount.toFixed(2)} HTG</td></tr>`;
            });
        }

    } else if (type === 'grandTotal') {
        titleElem.innerText = 'Détail - Total des Entrées Globales';
        headerElem.innerHTML = `<tr><th>Catégorie</th><th>Détails</th><th>Montant (HTG)</th></tr>`;

        let consultSum = 0;
        let examsSum = 0;

        patients.forEach(pt => {
            pt.visits.forEach(vst => {
                if (!lastResetTimestamp || (vst.dateTime && vst.dateTime >= lastResetTimestamp)) {
                    let paidPart = parseFloat(vst.consultPaidPart || 0);
                    if (paidPart > 0) consultSum += paidPart;

                    if (vst.adminExamsList) {
                        vst.adminExamsList.forEach(ex => {
                            let montantVerse = parseFloat(ex.montantVerse || ex.amount || 0);
                            if (montantVerse > 0) examsSum += montantVerse;
                        });
                    }
                }
            });
        });

        externalExamsList.forEach(ext => {
            let montantVerse = parseFloat(ext.priceRequired || 0);
            if (montantVerse > 0) examsSum += montantVerse;
        });

        totalVal = consultSum + examsSum;
        subtitleElem.innerText = `Somme totale des entrées : ${totalVal.toFixed(2)} HTG`;
        
        tbody.innerHTML = `
            <tr><td><strong>Consultations</strong></td><td>Total perçu sur les frais de consultation</td><td style="color:var(--primary-green); font-weight:bold;">${consultSum.toFixed(2)} HTG</td></tr>
            <tr><td><strong>Examens</strong></td><td>Total perçu sur les examens cliniques et hors-clinique</td><td style="color:var(--primary-green); font-weight:bold;">${examsSum.toFixed(2)} HTG</td></tr>
        `;

    } else if (type === 'recoveries') {
        titleElem.innerText = 'Détail - Compteur Séparé des Recouvrements';
        headerElem.innerHTML = `<tr><th>Patient</th><th>Type de Recouvrement & Date</th><th>Montant Recouvrée</th></tr>`;

        patients.forEach(pt => {
            if (pt.recoveryHistory) {
                pt.recoveryHistory.forEach(rec => {
                    if (!lastResetTimestamp || rec.dateTime >= lastResetTimestamp) {
                        let amt = parseFloat(rec.paidAmount || 0);
                        totalVal += amt;
                        detailsList.push({
                            name: `[${pt.id}] ${pt.name}`,
                            info: `${rec.typeLabel} (${formatISOToReadable(rec.dateTime)})`,
                            amount: amt
                        });
                    }
                });
            }
        });

        externalExamsList.forEach(ext => {
            if (ext.recoveryHistory) {
                ext.recoveryHistory.forEach(rec => {
                    if (!lastResetTimestamp || rec.dateTime >= lastResetTimestamp) {
                        let amt = parseFloat(rec.paidAmount || 0);
                        totalVal += amt;
                        detailsList.push({
                            name: ext.patientName || 'Hors-Clinique',
                            info: `${rec.typeLabel} (${formatISOToReadable(rec.dateTime)})`,
                            amount: amt
                        });
                    }
                });
            }
        });

        subtitleElem.innerText = `Total total des recouvrements (non ajouté au total global) : ${totalVal.toFixed(2)} HTG`;
        if (detailsList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Aucun recouvrement enregistré.</td></tr>`;
        } else {
            detailsList.forEach(item => {
                tbody.innerHTML += `<tr><td><strong>${item.name}</strong></td><td>${item.info}</td><td style="color:var(--warning-orange); font-weight:bold;">${item.amount.toFixed(2)} HTG</td></tr>`;
            });
        }
    }

    document.getElementById('financeDetailModal').style.display = 'flex';
}

function closeFinanceDetailModal() {
    document.getElementById('financeDetailModal').style.display = 'none';
}

function calculateBMI() {
    const h = parseFloat(document.getElementById('vHeight').value) / 100;
    const w = parseFloat(document.getElementById('vWeight').value);
    const bmiInput = document.getElementById('vBMI');
    const badge = document.getElementById('bmiBadge');

    if (h > 0 && w > 0) {
        const bmi = (w / (h * h)).toFixed(1);
        bmiInput.value = bmi;
        if (bmi < 18.5) { badge.innerText = 'Insuffisant'; badge.style.color = '#d97706'; }
        else if (bmi < 25) { badge.innerText = 'Normal'; badge.style.color = '#059669'; }
        else if (bmi < 30) { badge.innerText = 'Surpoids'; badge.style.color = '#d97706'; }
        else { badge.innerText = 'Obésité'; badge.style.color = '#dc2626'; }
    } else {
        bmiInput.value = '';
        badge.innerText = 'Statut : --';
        badge.style.color = 'var(--primary-green)';
    }
}

function toggleReportMode() {
    const mode = document.getElementById('reportModeSelect').value;
    const patientGroup = document.getElementById('patientReportFilterGroup');
    const vitalGroup = document.getElementById('vitalReportFilterGroup');
    const statusGroup = document.getElementById('statusReportFilterGroup');
    const sortGroup = document.getElementById('sortReportGroup');
    const header = document.getElementById('reportTableHeader');

    if (mode === 'patient') {
        patientGroup.style.display = 'block';
        vitalGroup.style.display = 'block';
        statusGroup.style.display = 'none';
        sortGroup.style.display = 'block';
        header.innerHTML = `
            <tr>
                <th style="width: 25%;">Date & Heure de la Visite</th>
                <th style="width: 55%;">Valeur / Résultats Enregistrés</th>
                <th style="width: 20%;">Statut de la Fiche</th>
            </tr>
        `;
    } else if (mode === 'status') {
        patientGroup.style.display = 'none';
        vitalGroup.style.display = 'none';
        statusGroup.style.display = 'block';
        sortGroup.style.display = 'block';
        header.innerHTML = `
            <tr>
                <th style="width: 30%;">Nom / Patient</th>
                <th style="width: 30%;">Type d'Examen</th>
                <th style="width: 20%;">Statut / Balance</th>
                <th style="width: 20%;">Provenance</th>
            </tr>
        `;
    } else if (mode === 'patientDebts') {
        patientGroup.style.display = 'block';
        vitalGroup.style.display = 'none';
        statusGroup.style.display = 'none';
        sortGroup.style.display = 'none';
        header.innerHTML = `
            <tr>
                <th style="width: 30%;">Catégorie de Dette</th>
                <th style="width: 40%;">Détails</th>
                <th style="width: 15%;">Montant Dû (HTG)</th>
                <th style="width: 15%;">Action</th>
            </tr>
        `;
    } else if (mode === 'recoveryHistory') {
        patientGroup.style.display = 'block';
        vitalGroup.style.display = 'none';
        statusGroup.style.display = 'none';
        sortGroup.style.display = 'none';
        header.innerHTML = `
            <tr>
                <th style="width: 25%;">Date & Heure</th>
                <th style="width: 25%;">Type de Dette</th>
                <th style="width: 25%;">Montant Versé</th>
                <th style="width: 25%;">Opérateur / Note</th>
            </tr>
        `;
    } else if (mode === 'allDebtors') {
        patientGroup.style.display = 'none';
        vitalGroup.style.display = 'none';
        statusGroup.style.display = 'none';
        sortGroup.style.display = 'none';
        header.innerHTML = `
            <tr>
                <th style="width: 30%;">Patient (ID / Origine)</th>
                <th style="width: 50%;">Détails des Dettes (Consultation, Examens, Pharmacie)</th>
                <th style="width: 20%;">Dette Totale (HTG)</th>
            </tr>
        `;
    }
    renderReports();
}

function calculatePatientDebts(pt) {
    let consultDebt = 0;
    let examsDebt = 0;
    let pharmacyDebt = 0;

    if (pt && pt.visits) {
        pt.visits.forEach(vst => {
            consultDebt += parseFloat(vst.consultDueAmount || 0);
            if (vst.adminExamsList) {
                vst.adminExamsList.forEach(ex => {
                    let montantDette = ex.montantDette !== undefined ? parseFloat(ex.montantDette || 0) : (ex.status === 'Balance due' ? parseFloat(ex.amount || 0) : 0);
                    if (montantDette > 0) {
                        examsDebt += montantDette;
                    }
                });
            }
        });
    }

    return {
        consultDebt,
        examsDebt,
        pharmacyDebt,
        totalDebt: consultDebt + examsDebt + pharmacyDebt
    };
}

function renderReports() {
    const mode = document.getElementById('reportModeSelect').value;
    const tbody = document.getElementById('reportTableBody');
    tbody.innerHTML = '';

    if (mode === 'patient') {
        const selectedPatientId = document.getElementById('globalReportPatientSelect').value || activePatientId;
        
        if (selectedPatientId && selectedPatientId.startsWith('EXT_')) {
            const extIdx = parseInt(selectedPatientId.replace('EXT_', ''));
            const ext = externalExamsList[extIdx];
            const vitalKey = document.getElementById('reportVitalSelect').value;
            const sortOrder = document.getElementById('reportSortSelect').value;

            let val = '--';
            if (vitalKey === 'labResults') val = ext.examName + ' (Hors-clinique)';
            else val = `Montant requis: ${ext.priceRequired || 0} HTG | Balance due: ${ext.balanceDue || 0} HTG`;

            tbody.innerHTML = `
                <tr>
                    <td>${ext.examDate || 'N/A'}</td>
                    <td>${val}</td>
                    <td>Patient Hors-Clinique</td>
                </tr>
            `;
            return;
        }

        const p = patients.find(pt => pt.id === selectedPatientId);
        const vitalKey = document.getElementById('reportVitalSelect').value;
        const sortOrder = document.getElementById('reportSortSelect').value;

        if (!p || !p.visits) return;

        let records = p.visits.map(v => {
            let val = v[vitalKey];
            if (vitalKey === 'bmi' && v.height && v.weight) {
                const h = parseFloat(v.height) / 100;
                const w = parseFloat(v.weight);
                val = (w / (h * h)).toFixed(1);
            }
            return {
                dateDisplay: v.dateTime ? formatISOToReadable(v.dateTime) : (v.date || '--'),
                value: val || '--',
                isDeceased: v.isDeceased,
                isReferred: v.isReferred
            };
        });

        if (sortOrder === 'asc') records.reverse();

        records.forEach(r => {
            const tr = document.createElement('tr');
            let statusLabel = 'Fiche Active';
            if (r.isDeceased) statusLabel = '💀 Décédé(e)';
            else if (r.isReferred) statusLabel = '🟠 Référé';

            tr.innerHTML = `
                <td>${r.dateDisplay}</td>
                <td>${r.value}</td>
                <td>${statusLabel}</td>
            `;
            tbody.appendChild(tr);
        });
    } else if (mode === 'status') {
        const targetStatus = document.getElementById('globalReportStatusSelect').value;
        let matchedItems = [];

        patients.forEach(pt => {
            pt.visits.forEach(vst => {
                if (vst.adminExamsList) {
                    vst.adminExamsList.forEach(ex => {
                        let itemStatus = ex.status;
                        if (targetStatus === 'En attente' || targetStatus === 'Livré') {
                            itemStatus = ex.deliveryStatus;
                        }
                        let montantDette = ex.montantDette !== undefined ? parseFloat(ex.montantDette || 0) : (ex.status === 'Balance due' ? parseFloat(ex.amount || 0) : 0);
                        if (itemStatus === targetStatus || (targetStatus === 'Balance due' && montantDette > 0)) {
                            let hasBalanceDue = montantDette > 0;
                            matchedItems.push({
                                name: `[${pt.id}] ${pt.name}`,
                                exam: ex.examName,
                                details: `Statut: ${ex.status} | Dette: ${montantDette} HTG`,
                                source: 'Clinique (Sect. 1 - Inpatient)',
                                hasBalance: hasBalanceDue
                            });
                        }
                    });
                }
            });
        });

        externalExamsList.forEach(ext => {
            let itemStatus = (parseFloat(ext.balanceDue) > 0) ? 'Balance due' : 'Payé';
            if (targetStatus === 'En attente' || targetStatus === 'Livré') {
                itemStatus = ext.deliveryStatus;
            }
            let montantDetteExt = parseFloat(ext.balanceDue || 0);
            if (itemStatus === targetStatus || (targetStatus === 'Balance due' && montantDetteExt > 0)) {
                let hasBalanceDue = montantDetteExt > 0;
                matchedItems.push({
                    name: ext.patientName || 'Hors-clinique (Anonyme)',
                    exam: ext.examName,
                    details: `Statut: ${hasBalanceDue ? 'Balance due' : 'Payé'} | Dette: ${montantDetteExt} HTG`,
                    source: 'Hors-clinique (Sect. 2 - Outpatient)',
                    hasBalance: hasBalanceDue
                });
            }
        });

        if (matchedItems.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Aucun examen trouvé avec le statut "${targetStatus}".</td></tr>`;
            return;
        }

        matchedItems.forEach(item => {
            let colorStyle = item.hasBalance ? 'color: var(--danger-red); font-weight: bold;' : 'color: var(--primary-green); font-weight: bold;';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="${colorStyle}">${item.name}</td>
                <td style="${colorStyle}">${item.exam}</td>
                <td style="${colorStyle}">${item.details}</td>
                <td style="${colorStyle}">${item.source}</td>
            `;
            tbody.appendChild(tr);
        });
    } else if (mode === 'patientDebts') {
        const selectedPatientId = document.getElementById('globalReportPatientSelect').value || activePatientId;
        
        if (selectedPatientId && selectedPatientId.startsWith('EXT_')) {
            const extIdx = parseInt(selectedPatientId.replace('EXT_', ''));
            const ext = externalExamsList[extIdx];
            let montantDetteExt = parseFloat(ext.balanceDue || 0);
            let rowsHtml = '';

            if (montantDetteExt > 0) {
                rowsHtml += `
                    <tr>
                        <td><strong>Examen Hors-Clinique</strong></td>
                        <td>${ext.examName} (${ext.patientName || 'Anonyme'})</td>
                        <td style="color: var(--danger-red); font-weight: bold;">${montantDetteExt.toFixed(2)} HTG</td>
                        <td><button class="btn btn-green" style="font-size: 0.75rem; padding: 4px 10px;" onclick="openRecoveryExtModal(${extIdx}, ${montantDetteExt})">Rec.</button></td>
                    </tr>
                `;
            } else {
                rowsHtml = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Aucune dette en cours pour ce patient hors-clinique.</td></tr>';
            }
            tbody.innerHTML = rowsHtml;
            return;
        }

        const p = patients.find(pt => pt.id === selectedPatientId);
        if (!p) return;

        const debts = calculatePatientDebts(p);
        let rowsHtml = '';
        
        if (debts.consultDebt > 0) {
            rowsHtml += `
                <tr>
                    <td><strong>Consultation</strong></td>
                    <td>Balance due sur la consultation du jour</td>
                    <td style="color: var(--purple-due); font-weight: bold;">${debts.consultDebt.toFixed(2)} HTG</td>
                    <td><button class="btn btn-green" style="font-size: 0.75rem; padding: 4px 10px;" onclick="openRecoveryModal('${p.id}', 'consult', 0, ${debts.consultDebt})">Rec.</button></td>
                </tr>
            `;
        }

        if (p.visits) {
            p.visits.forEach((vst, vIdx) => {
                if (vst.adminExamsList) {
                    vst.adminExamsList.forEach((ex, eIdx) => {
                        let montantDette = ex.montantDette !== undefined ? parseFloat(ex.montantDette || 0) : (ex.status === 'Balance due' ? parseFloat(ex.amount || 0) : 0);
                        if (montantDette > 0) {
                            rowsHtml += `
                                <tr>
                                    <td><strong>Examen Clinique</strong></td>
                                    <td>${ex.examName}</td>
                                    <td style="color: var(--danger-red); font-weight: bold;">${montantDette.toFixed(2)} HTG</td>
                                    <td><button class="btn btn-green" style="font-size: 0.75rem; padding: 4px 10px;" onclick="openRecoveryModal('${p.id}', 'exam', ${eIdx}, ${montantDette})">Rec.</button></td>
                                </tr>
                            `;
                        }
                    });
                }
            });
        }

        if (debts.pharmacyDebt > 0) {
            rowsHtml += `
                <tr>
                    <td><strong>Pharmacie</strong></td>
                    <td>Solde impayé produits pharmaceutiques</td>
                    <td style="color: var(--warning-orange); font-weight: bold;">${debts.pharmacyDebt.toFixed(2)} HTG</td>
                    <td><button class="btn btn-green" style="font-size: 0.75rem; padding: 4px 10px;" onclick="openRecoveryModal('${p.id}', 'pharmacy', 0, ${debts.pharmacyDebt})">Rec.</button></td>
                </tr>
            `;
        }

        if (rowsHtml === '') {
            rowsHtml = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Aucune dette enregistrée pour ce patient.</td></tr>';
        }

        tbody.innerHTML = rowsHtml;

    } else if (mode === 'recoveryHistory') {
        const selectedPatientId = document.getElementById('globalReportPatientSelect').value || activePatientId;
        
        if (selectedPatientId && selectedPatientId.startsWith('EXT_')) {
            const extIdx = parseInt(selectedPatientId.replace('EXT_', ''));
            const ext = externalExamsList[extIdx];
            if (!ext.recoveryHistory || ext.recoveryHistory.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Aucun historique de recouvrement pour ce patient hors-clinique.</td></tr>';
                return;
            }
            let historyHtml = '';
            ext.recoveryHistory.forEach(rec => {
                historyHtml += `
                    <tr>
                        <td><strong>${formatISOToReadable(rec.dateTime)}</strong></td>
                        <td>${rec.typeLabel}</td>
                        <td style="color: var(--primary-green); font-weight: bold;">+${rec.paidAmount.toFixed(2)} HTG</td>
                        <td>${rec.operator || 'Admin'}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = historyHtml;
            return;
        }

        const p = patients.find(pt => pt.id === selectedPatientId);

        if (!p || !p.recoveryHistory || p.recoveryHistory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Aucun historique de recouvrement pour ce patient.</td></tr>';
            return;
        }

        let historyHtml = '';
        p.recoveryHistory.forEach(rec => {
            historyHtml += `
                <tr>
                    <td><strong>${formatISOToReadable(rec.dateTime)}</strong></td>
                    <td>${rec.typeLabel}</td>
                    <td style="color: var(--primary-green); font-weight: bold;">+${rec.paidAmount.toFixed(2)} HTG</td>
                    <td>${rec.operator || 'Admin'}</td>
                </tr>
            `;
        });
        tbody.innerHTML = historyHtml;

    } else if (mode === 'allDebtors') {
        let count = 0;
        
        patients.forEach(pt => {
            const debts = calculatePatientDebts(pt);
            if (debts.totalDebt > 0) {
                count++;
                let detailsArr = [];
                if (debts.consultDebt > 0) detailsArr.push(`Consultation: ${debts.consultDebt.toFixed(2)} HTG`);
                if (debts.examsDebt > 0) detailsArr.push(`Examens: ${debts.examsDebt.toFixed(2)} HTG`);
                if (debts.pharmacyDebt > 0) detailsArr.push(`Pharmacie: ${debts.pharmacyDebt.toFixed(2)} HTG`);

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>[${pt.id}]</strong> ${pt.name} <span style="font-size:0.75rem; color:var(--primary-green); font-weight:bold;">(Clinique)</span></td>
                    <td>${detailsArr.join(' | ')}</td>
                    <td style="color: var(--danger-red); font-weight: 800; font-size: 0.95rem;">${debts.totalDebt.toFixed(2)} HTG</td>
                `;
                tbody.appendChild(tr);
            }
        });

        externalExamsList.forEach((ext, idx) => {
            let balanceDue = parseFloat(ext.balanceDue || 0);
            if (balanceDue > 0) {
                count++;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${ext.patientName || 'Patient Externe'}</strong> <span style="font-size:0.75rem; color:var(--warning-orange); font-weight:bold;">(Hors-Clinique)</span></td>
                    <td>Examen Externe (${ext.examName}) ${ext.patientPhone ? ' - Tél: ' + ext.patientPhone : ''}</td>
                    <td style="color: var(--danger-red); font-weight: 800; font-size: 0.95rem;">${balanceDue.toFixed(2)} HTG</td>
                `;
                tbody.appendChild(tr);
            }
        });

        if (count === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Aucun patient débiteur (Clinique ou Hors-Clinique) trouvé.</td></tr>';
        }
    }
}

function openRecoveryModal(patientId, type, index, currentDueAmount) {
    document.getElementById('recPatientId').value = patientId;
    document.getElementById('recType').value = type;
    document.getElementById('recIndex').value = index;
    document.getElementById('recAmountInput').value = '';
    document.getElementById('recDateTimeInput').value = getCurrentDateTimeInUTC5ISO();
    document.getElementById('recoveryModalSubtitle').innerText = `Montant actuellement dû : ${currentDueAmount.toFixed(2)} HTG`;
    document.getElementById('recoveryModal').style.display = 'flex';
}

function closeRecoveryModal() {
    document.getElementById('recoveryModal').style.display = 'none';
}

function openRecoveryExtModal(extIndex, currentDueAmount) {
    document.getElementById('recExtIndex').value = extIndex;
    document.getElementById('recExtAmountInput').value = '';
    document.getElementById('recExtDateTimeInput').value = getCurrentDateTimeInUTC5ISO();
    document.getElementById('recoveryExtModalSubtitle').innerText = `Montant actuellement dû : ${currentDueAmount.toFixed(2)} HTG`;
    document.getElementById('recoveryExtModal').style.display = 'flex';
}

function closeRecoveryExtModal() {
    document.getElementById('recoveryExtModal').style.display = 'none';
}

function processExtRecovery(e) {
    e.preventDefault();
    const extIndex = parseInt(document.getElementById('recExtIndex').value);
    const paidAmount = parseFloat(document.getElementById('recExtAmountInput').value);
    const customDateTime = document.getElementById('recExtDateTimeInput').value || getCurrentDateTimeInUTC5ISO();

    if (isNaN(paidAmount) || paidAmount <= 0) {
        alert('Veuillez saisir un montant versé valide.');
        return;
    }

    const ext = externalExamsList[extIndex];
    if (!ext) return;

    if (paidAmount >= parseFloat(ext.balanceDue || 0)) {
        ext.priceRequired = parseFloat(ext.priceRequired || 0) + parseFloat(ext.balanceDue || 0);
        ext.balanceDue = 0;
        ext.deliveryStatus = 'Livré';
    } else {
        ext.balanceDue = parseFloat(ext.balanceDue || 0) - paidAmount;
        ext.priceRequired = parseFloat(ext.priceRequired || 0) + paidAmount;
    }

    if (!ext.recoveryHistory) ext.recoveryHistory = [];
    ext.recoveryHistory.push({
        id: 'rec_ext_' + Date.now(),
        dateTime: customDateTime,
        typeLabel: `Recouvrement Examen Hors-Clinique (${ext.examName})`,
        paidAmount: paidAmount,
        operator: currentUser ? (currentUser.fullName || currentUser.username) : 'Admin'
    });

    saveToStorage();
    closeRecoveryExtModal();
    renderReports();
    alert(`Versement de ${paidAmount.toFixed(2)} HTG enregistré pour le patient hors-clinique !`);
}

function processRecovery(e) {
    e.preventDefault();
    const patientId = document.getElementById('recPatientId').value;
    const type = document.getElementById('recType').value;
    const index = parseInt(document.getElementById('recIndex').value);
    const paidAmount = parseFloat(document.getElementById('recAmountInput').value);
    const customDateTime = document.getElementById('recDateTimeInput').value || getCurrentDateTimeInUTC5ISO();

    if (isNaN(paidAmount) || paidAmount <= 0) {
        alert('Veuillez saisir un montant versé valide.');
        return;
    }

    const p = patients.find(pt => pt.id === patientId);
    if (!p) return;

    let typeLabel = '';
    const latestVst = p.visits && p.visits.length > 0 ? p.visits[p.visits.length - 1] : null;

    if (type === 'consult') {
        typeLabel = 'Recouvrement Consultation';
        if (latestVst) {
            if (paidAmount >= latestVst.consultDueAmount) {
                latestVst.consultPaidPart = parseFloat(latestVst.consultPaidPart || 0) + parseFloat(latestVst.consultDueAmount || 0);
                latestVst.consultDueAmount = 0;
            } else {
                latestVst.consultDueAmount -= paidAmount;
                latestVst.consultPaidPart = parseFloat(latestVst.consultPaidPart || 0) + paidAmount;
            }
        }
    } else if (type === 'exam') {
        typeLabel = 'Recouvrement Examen Clinique';
        if (latestVst && latestVst.adminExamsList && latestVst.adminExamsList[index]) {
            let ex = latestVst.adminExamsList[index];
            typeLabel = `Recouvrement Examen (${ex.examName})`;
            let currentDebt = ex.montantDette !== undefined ? parseFloat(ex.montantDette || 0) : parseFloat(ex.amount || 0);
            if (paidAmount >= currentDebt) {
                ex.montantDette = 0;
                ex.montantVerse = parseFloat(ex.montantVerse || 0) + currentDebt;
                ex.status = 'Payé';
                ex.deliveryStatus = 'Livré';
            } else {
                ex.montantDette = currentDebt - paidAmount;
                ex.montantVerse = parseFloat(ex.montantVerse || 0) + paidAmount;
            }
        }
    } else if (type === 'pharmacy') {
        typeLabel = 'Recouvrement Pharmacie';
        if (p.pharmacyDebt && p.pharmacyDebt > 0) {
            if (paidAmount >= p.pharmacyDebt) {
                p.pharmacyDebt = 0;
                p.hasPharmacyDebt = false;
            } else {
                p.pharmacyDebt -= paidAmount;
            }
        }
    }

    if (!p.recoveryHistory) p.recoveryHistory = [];

    p.recoveryHistory.push({
        id: 'rec_' + Date.now(),
        dateTime: customDateTime,
        typeLabel: typeLabel,
        paidAmount: paidAmount,
        operator: currentUser ? (currentUser.fullName || currentUser.username) : 'Admin'
    });

    saveToStorage();
    closeRecoveryModal();
    renderReports();
    if (activePatientId) renderDemographics(p);
    alert(`Versement de ${paidAmount.toFixed(2)} HTG enregistré et affecté au compteur correspondant !`);
}

function addNewVisit() {
    stopDictation();
    const p = patients.find(pt => pt.id === activePatientId);
    const newV = {
        id: 'v_' + Date.now(),
        dateTime: getCurrentDateTimeInUTC5ISO(),
        consultationReason: '', height: '', weight: '', bp: '', hr: '', temp: '', hpi: '', ros: [], labResults: '', ekgResults: '', sonoResults: '', imagingResults: '', assessment: '', plan: '', docName: '', isSpecialEvent: false, isReferred: false, isDeceased: false, consultPaidPart: '', consultDueAmount: '', specialDetails: '', adminExamsList: []
    };
    p.visits.push(newV);
    saveToStorage();
    switchVisit(newV.id);
}

function openNewPatientModal() {
    const pForm = document.querySelector('#patientModal form');
    if (pForm) pForm.reset();
    document.getElementById('mCustomId').value = 'MUV-' + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('patientModal').style.display = 'flex';
}
function closeModal() { document.getElementById('patientModal').style.display = 'none'; }

function saveNewPatient(e) {
    e.preventDefault();
    const customId = document.getElementById('mCustomId').value.trim();

    if (patients.some(pt => pt.id === customId)) {
        alert('Erreur : Cet ID unique existe déjà pour un autre patient. Veuillez en saisir un autre.');
        return;
    }

    const newP = {
        id: customId,
        name: document.getElementById('mName').value,
        nickname: document.getElementById('mNickname').value,
        sex: document.getElementById('mSex').value,
        profession: document.getElementById('mProfession').value.trim(),
        age: document.getElementById('mAge').value,
        dob: document.getElementById('mDOB').value,
        pob: document.getElementById('mPOB').value,
        nif: document.getElementById('mNIF').value,
        mother: document.getElementById('mMother').value,
        phone: document.getElementById('mPhone').value,
        address: document.getElementById('mAddress').value,
        eContact: document.getElementById('mEContact').value,
        eRel: document.getElementById('mERel').value,
        ePhone: document.getElementById('mEPhone').value,
        recoveryHistory: [],
        visits: []
    };
    patients.push(newP);
    saveToStorage();
    closeModal();
    selectPatient(newP.id);
}

// =====================================================================
// IMPRESSION — format simplifié (sans la mise en page du site)
// =====================================================================
const CLINIC_PRINT_NAME = 'Clinique Marie Ursule Vervil';

const PRINT_CSS = `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; margin: 0; }
    .hdr { text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 12px; }
    .hdr h1 { font-size: 18px; margin: 0 0 2px; }
    .hdr .sub { font-size: 13px; font-weight: bold; }
    h2 { font-size: 14px; margin: 14px 0 6px; border-bottom: 1px solid #000; padding-bottom: 2px; }
    h3 { font-size: 12.5px; margin: 10px 0 4px; }
    p { margin: 3px 0; }
    .lbl { font-weight: bold; }
    .txt { white-space: pre-wrap; margin: 2px 0 6px; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0; }
    th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; vertical-align: top; font-size: 11.5px; }
    th { background: #eee; }
    td.num, th.num { text-align: right; }
    tr.total td { font-weight: bold; background: #f5f5f5; }
    .visit { page-break-inside: avoid; margin-bottom: 14px; }
    .flag { display: inline-block; border: 1px solid #000; padding: 1px 6px; margin-right: 4px; font-weight: bold; font-size: 11px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; }
    .sign { margin-top: 36px; display: flex; justify-content: space-between; }
    .sign div { width: 40%; border-top: 1px solid #000; text-align: center; padding-top: 3px; font-size: 11px; }
    .ftr { margin-top: 18px; border-top: 1px solid #999; padding-top: 4px; font-size: 10px; color: #444; text-align: right; }
    img.chart { max-width: 100%; max-height: 260px; display: block; margin: 8px auto; }
`;

// Ouvre la boîte d'impression du navigateur avec un document propre (iframe invisible).
function printHtmlDocument(title, bodyHtml) {
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
        <style>${PRINT_CSS}</style></head><body>
        <div class="hdr"><h1>${CLINIC_PRINT_NAME}</h1><div class="sub">${escapeHtml(title)}</div></div>
        ${bodyHtml}
        <div class="ftr">Imprimé le ${new Date().toLocaleString('fr-FR')}</div>
        </body></html>`;

    const old = document.getElementById('printFrame');
    if (old) old.remove();
    const iframe = document.createElement('iframe');
    iframe.id = 'printFrame';
    iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0;';
    document.body.appendChild(iframe);
    iframe.onload = () => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            alert("Impossible d'ouvrir l'impression sur ce navigateur.");
        }
        setTimeout(() => iframe.remove(), 60000);
    };
    iframe.srcdoc = doc;
}

const pe = v => escapeHtml(v === undefined || v === null || v === '' ? '—' : v);
const fmtMoney = n => (parseFloat(n) || 0).toFixed(2) + ' HTG';
const fmtDateTime = s => (s || '').replace('T', ' ').slice(0, 16) || '—';

// ---------- Patient / visite ----------
function buildPatientHeaderHtml(p) {
    return `
        <h2>Identification du patient</h2>
        <div class="grid2">
            <p><span class="lbl">Nom :</span> ${pe(p.name)}${p.nickname ? ' (' + escapeHtml(p.nickname) + ')' : ''}</p>
            <p><span class="lbl">ID dossier :</span> ${pe(p.id)}</p>
            <p><span class="lbl">NIF / NINU :</span> ${pe(p.nif)}</p>
            <p><span class="lbl">Sexe :</span> ${pe(p.sex)}</p>
            <p><span class="lbl">Âge / Naissance :</span> ${pe(p.age)} ans (${pe(p.dob)})</p>
            <p><span class="lbl">Profession :</span> ${pe(p.profession)}</p>
            <p><span class="lbl">Téléphone :</span> ${pe(p.phone)}</p>
            <p><span class="lbl">Adresse :</span> ${pe(p.address)}</p>
            <p><span class="lbl">Contact d'urgence :</span> ${pe(p.eContact)} (${pe(p.eRel)}) ${escapeHtml(p.ePhone || '')}</p>
        </div>`;
}

function textBlock(label, value) {
    if (!value || !String(value).trim()) return '';
    return `<p class="lbl">${escapeHtml(label)}</p><div class="txt">${escapeHtml(value)}</div>`;
}

function buildVisitHtml(v, index) {
    const flags = [];
    if (v.isDeceased) flags.push('Décédé(e)');
    if (v.isReferred) flags.push('Référé(e)');
    if (v.isSpecialEvent) flags.push('Événement spécial');

    const h = parseFloat(v.height), w = parseFloat(v.weight);
    const bmi = (h > 0 && w > 0) ? (w / Math.pow(h / 100, 2)).toFixed(1) : '—';

    const exams = (v.adminExamsList || []);
    const examsHtml = exams.length ? `
        <h3>Examens cliniques</h3>
        <table><thead><tr><th>Examen</th><th>Statut</th><th class="num">Versé</th><th class="num">Dette</th></tr></thead><tbody>
        ${exams.map(e => `<tr><td>${pe(e.examName)}</td><td>${pe(e.status)}</td><td class="num">${fmtMoney(e.montantVerse)}</td><td class="num">${fmtMoney(e.montantDette)}</td></tr>`).join('')}
        </tbody></table>` : '';

    return `
        <div class="visit">
            <h2>Visite${index !== undefined ? ' n° ' + (index + 1) : ''} — ${escapeHtml(fmtDateTime(v.dateTime))}</h2>
            ${flags.length ? '<p>' + flags.map(f => `<span class="flag">${f}</span>`).join('') + '</p>' : ''}
            ${textBlock('Motif de consultation', v.consultationReason)}
            <table>
                <thead><tr><th>Taille</th><th>Poids</th><th>IMC</th><th>TA</th><th>Pouls</th><th>Temp.</th><th>FR</th><th>SpO2</th><th>Glycémie</th></tr></thead>
                <tbody><tr>
                    <td>${pe(v.height)} cm</td><td>${pe(v.weight)} kg</td><td>${bmi}</td><td>${pe(v.bp)}</td>
                    <td>${pe(v.hr)}</td><td>${pe(v.temp)} °C</td><td>${pe(v.fr)}</td><td>${pe(v.spo2)} %</td><td>${pe(v.glyc)}</td>
                </tr></tbody>
            </table>
            ${textBlock('Histoire de la maladie actuelle', v.hpi)}
            ${(v.ros && v.ros.length) ? `<p class="lbl">Revue des systèmes</p><div class="txt">${escapeHtml(v.ros.join(', '))}</div>` : ''}
            ${textBlock('Résultats de laboratoire', v.labResults)}
            ${textBlock('Résultats ECG', v.ekgResults)}
            ${textBlock('Résultats échographie', v.sonoResults)}
            ${textBlock('Résultats imagerie', v.imagingResults)}
            ${textBlock('Diagnostic', v.assessment)}
            ${textBlock('Plan de traitement', v.plan)}
            ${examsHtml}
            <p><span class="lbl">Frais de consultation versés :</span> ${fmtMoney(v.consultPaidPart)}
               &nbsp;|&nbsp; <span class="lbl">Montant dû :</span> ${fmtMoney(v.consultDueAmount)}</p>
            ${textBlock('Observations / circonstances', v.specialDetails)}
            <div class="sign"><div>Médecin : ${escapeHtml(v.docName || '')}</div><div>Signature</div></div>
        </div>`;
}

// État actuel du formulaire (même non enregistré) fusionné avec la visite active
function getVisitSnapshot() {
    const p = patients.find(pt => pt.id === activePatientId);
    const v = p && p.visits.find(x => x.id === activeVisitId);
    if (!v) return null;
    const g = id => { const e = document.getElementById(id); return e ? e.value : ''; };
    const c = id => { const e = document.getElementById(id); return !!(e && e.checked); };
    return {
        patient: p,
        index: p.visits.indexOf(v),
        visit: Object.assign({}, v, {
            dateTime: g('visitDateTimeInput') || v.dateTime,
            consultationReason: g('txtConsultationReason'),
            height: g('vHeight'), weight: g('vWeight'), bp: g('vBP'), hr: g('vHR'), temp: g('vTemp'),
            fr: g('vFR'), spo2: g('vSpO2'), glyc: g('vGlyc'),
            hpi: g('txtHPI'), labResults: g('txtLabResults'), ekgResults: g('txtEKGResults'),
            sonoResults: g('txtSonoResults'), imagingResults: g('txtImagingResults'),
            assessment: g('txtAssessment'), plan: g('txtPlan'), docName: g('docName'),
            ros: Array.from(document.querySelectorAll('#rosContainer input:checked')).map(cb => cb.value),
            isSpecialEvent: c('chkSpecialEvent'), isReferred: c('chkReferred'), isDeceased: c('chkDeceased'),
            consultPaidPart: g('txtConsultPaidPart'), consultDueAmount: g('txtConsultDueAmount'),
            specialDetails: g('txtSpecialDetails')
        })
    };
}

function printCurrentVisit() {
    const snap = getVisitSnapshot();
    if (!snap) { alert('Aucune visite active à imprimer.'); return; }
    printHtmlDocument('Fiche de consultation', buildPatientHeaderHtml(snap.patient) + buildVisitHtml(snap.visit, snap.index));
}

function printPatientRecord() {
    const p = patients.find(pt => pt.id === activePatientId);
    if (!p) { alert('Aucun patient actif.'); return; }
    const visits = (p.visits || []).map((v, i) => buildVisitHtml(v, i)).join('') || '<p>Aucune visite enregistrée.</p>';
    printHtmlDocument('Dossier patient', buildPatientHeaderHtml(p) + visits);
}

// ---------- Pharmacie : recettes et approvisionnements ----------
function printRevenue(idx) {
    const r = pharmacyRevenues[idx];
    if (!r) return;
    const lines = r.medLines || [];
    const rows = lines.length ? lines.map(l => `
        <tr><td>${pe(l.name)}</td><td class="num">${pe(l.qty)}</td><td>${pe(l.unit)}</td>
        <td class="num">${fmtMoney(l.price)}</td><td class="num">${fmtMoney((parseFloat(l.price) || 0) * (parseFloat(l.qty) || 0))}</td></tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;">Aucun détail de médicament enregistré.</td></tr>';

    printHtmlDocument('Recette de la pharmacie', `
        <p><span class="lbl">Date :</span> ${pe(r.date)}</p>
        <p><span class="lbl">N° de la fiche de vente :</span> ${pe(r.description)}</p>
        <table>
            <thead><tr><th>Médicament</th><th class="num">Qté</th><th>Unité</th><th class="num">Prix unitaire</th><th class="num">Total</th></tr></thead>
            <tbody>${rows}
                <tr class="total"><td colspan="4" class="num">MONTANT TOTAL</td><td class="num">${fmtMoney(r.amount)}</td></tr>
            </tbody>
        </table>
        ${r.fileData ? `<p><span class="lbl">Document joint :</span> ${escapeHtml(r.fileName)}</p>` : ''}
        <div class="sign"><div>Pharmacien(ne)</div><div>Signature</div></div>`);
}

function printRevenueList() {
    if (!pharmacyRevenues.length) { alert('Aucune recette à imprimer.'); return; }
    let total = 0;
    const rows = pharmacyRevenues.map(r => {
        total += parseFloat(r.amount) || 0;
        return `<tr><td>${pe(r.date)}</td><td>${pe(r.description)}</td><td class="num">${(r.medLines || []).length}</td><td class="num">${fmtMoney(r.amount)}</td></tr>`;
    }).join('');
    printHtmlDocument('Recettes de la pharmacie', `
        <table>
            <thead><tr><th>Date</th><th>N° fiche de vente</th><th class="num">Articles</th><th class="num">Montant</th></tr></thead>
            <tbody>${rows}<tr class="total"><td colspan="3" class="num">TOTAL</td><td class="num">${fmtMoney(total)}</td></tr></tbody>
        </table>`);
}

function printSupplyList() {
    if (!pharmacySupplies.length) { alert("Aucun approvisionnement à imprimer."); return; }
    const rows = pharmacySupplies.map(s => `<tr><td>${pe(s.date)}</td><td>${pe(s.fileName)}</td></tr>`).join('');
    printHtmlDocument("Historique des approvisionnements", `
        <table><thead><tr><th>Date d'achat</th><th>Reçu / fichier</th></tr></thead><tbody>${rows}</tbody></table>`);
}

// ---------- Rapports ----------
function printReport() {
    const sel = id => {
        const e = document.getElementById(id);
        const group = e && e.closest('div[id]');
        if (!e || (group && group.style.display === 'none')) return null;
        return e.options && e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : e.value;
    };
    const crit = [];
    const add = (label, v) => { if (v) crit.push(`<p><span class="lbl">${label} :</span> ${escapeHtml(v)}</p>`); };
    const mode = sel('reportModeSelect');
    add('Type de rapport', mode);
    const modeVal = document.getElementById('reportModeSelect').value;
    if (modeVal === 'patient') { add('Patient', sel('globalReportPatientSelect')); add('Donnée', sel('reportVitalSelect')); }
    if (modeVal === 'status') add('Statut', sel('globalReportStatusSelect'));
    add('Ordre', sel('reportSortSelect'));

    const headCells = Array.from(document.querySelectorAll('#reportTableHeader th')).map(th => `<th>${escapeHtml(th.innerText)}</th>`).join('');
    const bodyRows = Array.from(document.querySelectorAll('#reportTableBody tr')).map(tr =>
        '<tr>' + Array.from(tr.querySelectorAll('td')).map(td => `<td>${escapeHtml(td.innerText)}</td>`).join('') + '</tr>').join('');

    let chartHtml = '';
    const cont = document.getElementById('reportChartsContainer');
    if (cont && cont.style.display !== 'none' && typeof reportChartInstance !== 'undefined' && reportChartInstance) {
        chartHtml = `<h2>Graphique</h2><img class="chart" src="${document.getElementById('reportCanvasChart').toDataURL('image/png')}" alt="Graphique">`;
    }
    printHtmlDocument('Rapport', `${crit.join('')}<table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>${chartHtml}`);
}

// Rafraîchit le graphique quand le tableau du rapport change
const renderReportsCore = renderReports;
renderReports = function () {
    renderReportsCore();
    const chk = document.getElementById('chkToggleReportCharts');
    if (chk && chk.checked && typeof renderReportChart === 'function') renderReportChart();
};

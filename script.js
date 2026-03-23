/**
 * 管理画面ロジック
 * 仕様書に基づき、Cloud Run上の backend-admin API と通信します。
 */

// ==========================================
// 設定・定数
// ==========================================
const USE_MOCK = false;
const API_BASE_URL = "https://backend-admin-v2-482800127304.asia-northeast1.run.app/api/admin";
const PREFERRED_SEAT_PRICE = 500;
const SPECIAL_MEMBER_DISCOUNT_PER_PERSON = 300;
const MANUAL_PRICE_PLUS_PER_PERSON = 100;
const JAPAN_TIME_ZONE = 'Asia/Tokyo';

// 状態管理
let currentAuthToken = null;
let cachedTours = [];
let cachedReservations = [];
let cachedPickups = [];
let cachedWaitlist = [];

function getJstDateParts(dateValue) {
    var date = dateValue ? new Date(dateValue) : new Date();
    if (isNaN(date.getTime())) return null;

    var formatter = new Intl.DateTimeFormat('ja-JP', {
        timeZone: JAPAN_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    var parts = formatter.formatToParts(date);
    var map = {};
    parts.forEach(function(part) {
        if (part.type !== 'literal') map[part.type] = part.value;
    });
    return map;
}

function toJstDateString(dateValue) {
    var p = getJstDateParts(dateValue);
    if (!p) return '';
    return p.year + '-' + p.month + '-' + p.day;
}

function toJstIsoString(dateValue) {
    var p = getJstDateParts(dateValue);
    if (!p) return '';
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + '+09:00';
}

function formatDateTimeForJstDisplay(dateValue) {
    if (!dateValue) return '-';
    var date = new Date(dateValue);
    if (isNaN(date.getTime())) return String(dateValue);
    var p = getJstDateParts(date);
    if (!p) return String(dateValue);
    return p.year + '/' + p.month + '/' + p.day + ' ' + p.hour + ':' + p.minute;
}

function getAuthHeaders() {
    return { Authorization: `Bearer ${currentAuthToken}` };
}

function normalizeTour(tour) {
    return {
        ...tour,
        deadline: tour.deadline || tour.deadline_date || '',
        imageUrl: tour.imageUrl || tour.image_url || '',
        current: tour.current ?? tour.current_count ?? 0,
        pickupIds: Array.isArray(tour.pickupIds) ? tour.pickupIds : []
    };
}

function normalizePickup(pickup) {
    return {
        ...pickup,
        active: pickup.active ?? pickup.isActive ?? true,
        sortOrder: pickup.sortOrder ?? 0
    };
}

function normalizeReservation(reservation) {
    const userInfo = reservation.userInfo || {};
    const pickups = Array.isArray(reservation.pickups) ? reservation.pickups : [];
    const preferredSeats = Array.isArray(reservation.preferredSeats) ? reservation.preferredSeats : [];
    const firstPickup = pickups.length > 0 ? pickups[0] : '';
    const hasPreferredSeat = preferredSeats.some(Boolean);

    return {
        id: reservation.id,
        lineUserId: reservation.lineUserId || reservation.line_user_id || '',
        lineDisplayName: reservation.lineDisplayName || '',
        progressStatus: reservation.progressStatus || reservation.progress_status || 'shipping',
        tour_id: reservation.tour_id || reservation.tourId || '',
        tour_name: reservation.tour_name || reservation.tourTitle || '',
        date: reservation.date || '',
        name: reservation.name || userInfo.name || '',
        phone: reservation.phone || userInfo.phone || '',
        address: reservation.address || `${userInfo.pref || ''}${userInfo.city || ''}${userInfo.street || ''}`,
        count: Number(reservation.passengers ?? reservation.count ?? 0),
        amount: Number(reservation.amount ?? reservation.totalPrice ?? 0),
        specialMember: !!reservation.specialMember,
        memberDiscountTotal: Number(reservation.memberDiscountTotal ?? 0),
        status: reservation.status || 'confirmed',
        pickup: reservation.pickup || firstPickup,
        pickups: pickups,
        seat_pref: reservation.seat_pref || (hasPreferredSeat ? 'あり' : 'なし'),
        createdAt: reservation.createdAt || '',
        progressLog: Array.isArray(reservation.progressLog)
            ? reservation.progressLog
            : (Array.isArray(reservation.progress_log) ? reservation.progress_log : [])
    };
}

function getStatusMeta(statusKey) {
    if (statusKey === 'pending') return { label: '予約申込中', className: 'text-yellow-600 bg-yellow-50' };
    if (statusKey === 'confirmed') return { label: 'ご予約確定', className: 'text-green-600 bg-green-50' };
    if (statusKey === 'cancelled') return { label: 'キャンセル', className: 'text-red-600 bg-red-50' };
    if (statusKey === 'waitlist') return { label: 'キャンセル待ち', className: 'text-orange-600 bg-orange-50' };
    return { label: '予約申込中', className: 'text-yellow-600 bg-yellow-50' };
}

function getProgressMeta(progressKey) {
    if (progressKey === 'middle') return { label: '中間', className: 'text-blue-600 bg-blue-50' };
    if (progressKey === 'final') return { label: '最終', className: 'text-purple-600 bg-purple-50' };
    if (progressKey === 'need_check') return { label: '要確認', className: 'text-red-600 bg-red-50' };
    return { label: '発送', className: 'text-green-600 bg-green-50' };
}

function getProgressMethodLabel(methodKey) {
    var map = {
        phone: '電話',
        line_personal: '個人LINE',
        line_official: '公式LINE',
        email: 'メール',
        other: 'その他'
    };
    return map[methodKey] || 'その他';
}

function sortProgressLogsDesc(logs) {
    return (Array.isArray(logs) ? logs.slice() : []).sort(function(a, b) {
        var aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        var bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
    });
}

function getLatestProgressEntry(reservation) {
    var logs = sortProgressLogsDesc(reservation.progressLog || []);
    if (logs.length > 0) return logs[0];
    return {
        status: reservation.progressStatus || 'shipping',
        method: '',
        memo: '',
        updatedAt: reservation.updatedAt || reservation.createdAt || ''
    };
}

function buildProgressLogHistoryHtml(reservation) {
    var logs = sortProgressLogsDesc(reservation.progressLog || []);
    if (logs.length === 0) {
        return '<p class="text-xs text-gray-500">進捗記録はまだありません</p>';
    }

    return logs.map(function(log) {
        var meta = getProgressMeta(log.status || 'shipping');
        var methodLabel = getProgressMethodLabel(log.method || 'other');
        var updated = log.updatedAt || log.createdAt || '';
        return '<div class="p-2 border rounded bg-white mb-2">'
            + '<div class="flex items-center justify-between gap-2 mb-1">'
            + '<span class="px-2 py-0.5 rounded text-xs font-bold ' + meta.className + '">' + meta.label + '</span>'
            + '<span class="text-xs text-gray-500">' + formatDateTimeForJstDisplay(updated) + '</span>'
            + '</div>'
            + '<div class="text-xs text-gray-700 mb-1">手段: ' + methodLabel + '</div>'
            + '<div class="text-xs text-gray-800 whitespace-pre-wrap">' + (log.memo || '（メモなし）') + '</div>'
            + '</div>';
    }).join('');
}

const expandedProgressRows = new Set();
const progressMethodPrefs = {};
const progressMemoDrafts = {};

function getProgressMethodPrefKey(reservation) {
    if (!reservation) return '';
    if (reservation.lineUserId) return 'line:' + reservation.lineUserId;
    return 'reservation:' + reservation.id;
}

function loadProgressMethodPrefs() {
    try {
        var raw = localStorage.getItem('progress_method_prefs_v1');
        var data = raw ? JSON.parse(raw) : {};
        Object.keys(progressMethodPrefs).forEach(function(key) { delete progressMethodPrefs[key]; });
        Object.assign(progressMethodPrefs, data || {});
    } catch (err) {
        console.warn('Failed to load progress method prefs:', err);
    }
}

function saveProgressMethodPrefs() {
    try {
        localStorage.setItem('progress_method_prefs_v1', JSON.stringify(progressMethodPrefs));
    } catch (err) {
        console.warn('Failed to save progress method prefs:', err);
    }
}

function getProgressMemoDraftKey(reservation) {
    if (!reservation) return '';
    if (reservation.lineUserId) return 'line:' + reservation.lineUserId;
    return 'reservation:' + reservation.id;
}

function loadProgressMemoDrafts() {
    try {
        var raw = localStorage.getItem('progress_memo_drafts_v1');
        var data = raw ? JSON.parse(raw) : {};
        Object.keys(progressMemoDrafts).forEach(function(key) { delete progressMemoDrafts[key]; });
        Object.assign(progressMemoDrafts, data || {});
    } catch (err) {
        console.warn('Failed to load progress memo drafts:', err);
    }
}

function saveProgressMemoDrafts() {
    try {
        localStorage.setItem('progress_memo_drafts_v1', JSON.stringify(progressMemoDrafts));
    } catch (err) {
        console.warn('Failed to save progress memo drafts:', err);
    }
}

function getPreferredProgressMemo(reservation, status) {
    if (!reservation) return '';
    var prefKey = getProgressMemoDraftKey(reservation);
    if (prefKey && progressMemoDrafts[prefKey]) return progressMemoDrafts[prefKey];

    var logs = sortProgressLogsDesc(reservation.progressLog || []);
    if (status) {
        var sameStatusLog = logs.find(function(log) {
            return (log.status || '') === status && !!(log.memo || '').trim();
        });
        if (sameStatusLog) return sameStatusLog.memo || '';
    }
    var latestMemoLog = logs.find(function(log) { return !!(log.memo || '').trim(); });
    return latestMemoLog ? (latestMemoLog.memo || '') : '';
}

function savePreferredProgressMemo(reservation, memo) {
    var prefKey = getProgressMemoDraftKey(reservation);
    if (!prefKey) return;
    progressMemoDrafts[prefKey] = memo || '';
    saveProgressMemoDrafts();
}

function getPreferredProgressMethod(reservation, status) {
    if (!reservation) return 'phone';
    var logs = sortProgressLogsDesc(reservation.progressLog || []);
    if (status) {
        var sameStatusLog = logs.find(function(log) {
            return (log.status || '') === status && !!log.method;
        });
        if (sameStatusLog && sameStatusLog.method) return sameStatusLog.method;
    }
    var latestWithMethod = logs.find(function(log) { return !!log.method; });
    if (latestWithMethod && latestWithMethod.method) return latestWithMethod.method;

    var prefKey = getProgressMethodPrefKey(reservation);
    if (prefKey && progressMethodPrefs[prefKey]) return progressMethodPrefs[prefKey];
    return 'phone';
}

function savePreferredProgressMethod(reservation, method) {
    var prefKey = getProgressMethodPrefKey(reservation);
    if (!prefKey || !method) return;
    progressMethodPrefs[prefKey] = method;
    saveProgressMethodPrefs();
}

function resolvePickupName(idOrName) {
    if (!idOrName) return null;
    // cachedPickupsのIDと照合
    var found = cachedPickups.find(function(p) { return p.id === idOrName; });
    if (found) return found.name || found.displayName || idOrName;
    return idOrName; // IDでなければそのまま
}

function formatPickupsDisplay(r) {
    var pickups = Array.isArray(r.pickups) ? r.pickups.filter(Boolean) : [];
    if (pickups.length === 0) return r.pickup || '-';
    var resolved = pickups.map(resolvePickupName).filter(Boolean);
    var unique = resolved.filter(function(v, i, a) { return a.indexOf(v) === i; });
    if (unique.length === 1) return unique[0];
    return resolved.join(', ');
}

function getActivePickupNames() {
    return cachedPickups
        .filter(function(p) { return p.active; })
        .sort(function(a, b) { return a.sortOrder - b.sortOrder; })
        .map(function(p) { return p.name; });
}

function getPickupSelectHtml(selectedValue) {
    var selected = selectedValue || '';
    var optionsHtml = '<option value="">未選択</option>';
    var names = getActivePickupNames();
    names.forEach(function(name) {
        optionsHtml += '<option value="' + name + '"' + (selected === name ? ' selected' : '') + '>' + name + '</option>';
    });
    if (selected && names.indexOf(selected) === -1) {
        optionsHtml += '<option value="' + selected + '" selected>' + selected + '（非アクティブ）</option>';
    }
    return optionsHtml;
}

function buildPickupRowHtml(selectedValue, index) {
    return '<div class="flex gap-2 items-center mb-2" data-pickup-row="1">'
        + '<span class="text-xs text-gray-500 w-12">' + (index + 1) + '人目</span>'
        + '<select class="edit-res-pickup-item flex-1 border p-2 rounded text-sm bg-white">' + getPickupSelectHtml(selectedValue) + '</select>'
        + '<button type="button" onclick="removeReservationPickupRow(this)" class="px-3 py-2 rounded text-xs border bg-white hover:bg-gray-50">削除</button>'
        + '</div>';
}

function initReservationPickupEditor(reservation) {
    var container = document.getElementById('edit-res-pickups-container');
    if (!container) return;

    var rawPickups = Array.isArray(reservation.pickups) ? reservation.pickups.filter(Boolean) : [];
    var resolvedPickups = rawPickups.map(resolvePickupName).filter(Boolean);
    if (resolvedPickups.length === 0 && reservation.pickup) {
        resolvedPickups = [resolvePickupName(reservation.pickup) || reservation.pickup];
    }
    if (resolvedPickups.length === 0) {
        resolvedPickups = [''];
    }

    container.innerHTML = resolvedPickups.map(function(p, idx) {
        return buildPickupRowHtml(p, idx);
    }).join('');
    refreshReservationPickupRowLabels();
}

function refreshReservationPickupRowLabels() {
    var rows = Array.from(document.querySelectorAll('#edit-res-pickups-container [data-pickup-row="1"]'));
    rows.forEach(function(row, idx) {
        var label = row.querySelector('span');
        if (label) {
            label.innerText = (idx + 1) + '人目';
        }
    });
}

function addReservationPickupRow() {
    var container = document.getElementById('edit-res-pickups-container');
    if (!container) return;
    var rowCount = container.querySelectorAll('[data-pickup-row="1"]').length;
    container.insertAdjacentHTML('beforeend', buildPickupRowHtml('', rowCount));
    refreshReservationPickupRowLabels();
}

function removeReservationPickupRow(button) {
    var container = document.getElementById('edit-res-pickups-container');
    if (!container || !button) return;
    var rows = container.querySelectorAll('[data-pickup-row="1"]');
    if (rows.length <= 1) {
        alert('乗車地は最低1件残してください');
        return;
    }
    var row = button.closest('[data-pickup-row="1"]');
    if (row) row.remove();
    refreshReservationPickupRowLabels();
}

function fillPickupRowsByCount() {
    var countInput = document.getElementById('edit-res-count');
    var container = document.getElementById('edit-res-pickups-container');
    if (!countInput || !container) return;
    var count = parseInt(countInput.value, 10);
    if (!count || count < 1) count = 1;

    var currentValues = Array.from(container.querySelectorAll('.edit-res-pickup-item')).map(function(el) {
        return el.value || '';
    });
    var first = currentValues[0] || '';
    var nextValues = [];
    for (var i = 0; i < count; i++) {
        nextValues.push(currentValues[i] !== undefined ? currentValues[i] : first);
    }
    container.innerHTML = nextValues.map(function(v, idx) {
        return buildPickupRowHtml(v, idx);
    }).join('');
    refreshReservationPickupRowLabels();
}

function getEditedPickupValues() {
    var values = Array.from(document.querySelectorAll('.edit-res-pickup-item')).map(function(el) {
        return (el.value || '').trim();
    }).filter(Boolean);
    return values;
}

function sortToursByDateAsc(a, b) {
    var dateCompare = (a.date || '').localeCompare(b.date || '');
    if (dateCompare !== 0) return dateCompare;
    return (a.title || '').localeCompare(b.title || '');
}

// ==========================================
// 1. 初期化・認証
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    loadProgressMethodPrefs();
    loadProgressMemoDrafts();
    var progressStatusSelect = document.getElementById('progress-modal-status');
    if (progressStatusSelect) {
        progressStatusSelect.addEventListener('change', onProgressModalStatusChange);
    }
    var progressMemoInput = document.getElementById('progress-modal-memo');
    if (progressMemoInput) {
        progressMemoInput.addEventListener('input', onProgressModalMemoInput);
    }
});

async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById('login-password').value;

    if (USE_MOCK) {
        if (password === 'admin') {
            loginSuccess('mock-token-123');
        } else {
            alert('パスワードが違います');
        }
    } else {
        try {
            const res = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            if (res.ok) {
                const data = await res.json();
                loginSuccess(data.token);
            } else {
                const errorBody = await res.json().catch(() => ({}));
                alert(errorBody.error === 'invalid_password' ? 'パスワードが違います' : '認証失敗');
            }
        } catch (err) {
            console.error(err);
            alert('通信エラー');
        }
    }
}

function loginSuccess(token) {
    currentAuthToken = token;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('flex');
    loadInitialData().catch((err) => {
        console.error(err);
        alert('初期データ取得に失敗しました。再ログインしてください。');
        logout();
    });
}

function logout() {
    if (confirm('ログアウトしますか？')) {
        location.reload();
    }
}

// ==========================================
// ハンバーガーメニュー（モバイル）
// ==========================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = !sidebar.classList.contains('-translate-x-full');
    
    if (isOpen) {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    } else {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    }
}

function closeSidebarMobile() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (window.innerWidth < 1024) {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    }
}

// ==========================================
// 2. データ取得・表示ロジック
// ==========================================
async function loadInitialData() {
    if (USE_MOCK) {
        cachedTours = [
            { id: 't1', title: '春の九州・温泉めぐり', date: '2026-03-15', capacity: 40, price: 12000, status: 'open', deadline: '2026-03-10', current: 15, pickupIds: ['p1', 'p2', 'p3'] },
            { id: 't2', title: '東京湾ナイトクルーズ', date: '2026-03-20', capacity: 20, price: 8000, status: 'full', deadline: '2026-03-18', current: 20, pickupIds: ['p1'] },
            { id: 't3', title: '富士山日帰りバス', date: '2026-04-01', capacity: 45, price: 10000, status: 'stop', deadline: '2026-03-30', current: 0, pickupIds: [] }
        ];
        cachedReservations = [
            { id: 'r1', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '山田 太郎', phone: '090-1234-5678', address: '東京都新宿区西新宿1-1-1', count: 2, amount: 24000, status: 'confirmed', progressStatus: 'shipping', pickup: '新宿駅 西口', seat_pref: 'あり' },
            { id: 'r2', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '佐藤 花子', phone: '080-9876-5432', address: '神奈川県横浜市中区1-2-3', count: 1, amount: 12000, status: 'confirmed', progressStatus: 'middle', pickup: '横浜駅 東口', seat_pref: 'なし' },
            { id: 'r3', tour_id: 't2', tour_name: '東京湾ナイトクルーズ', date: '2026-03-20', name: '鈴木 一郎', phone: '070-1111-2222', address: '埼玉県さいたま市大宮区3-4-5', count: 4, amount: 32000, status: 'confirmed', progressStatus: 'final', pickup: '東京駅 丸の内北口', seat_pref: 'あり' },
            { id: 'r4', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '田中 キャンセル', phone: '090-0000-0000', address: '千葉県千葉市中央区5-6-7', count: 2, amount: 24000, status: 'cancelled', progressStatus: 'shipping', pickup: '新宿駅 西口', seat_pref: 'なし' }
        ];
        cachedPickups = [
            { id: 'p1', name: '新宿駅 西口', sortOrder: 1, active: true },
            { id: 'p2', name: '東京駅 丸の内北口', sortOrder: 2, active: true },
            { id: 'p3', name: '横浜駅 東口', sortOrder: 3, active: true },
            { id: 'p4', name: '大宮駅 西口', sortOrder: 4, active: false }
        ];
    } else {
        const [resTours, resPick, resPending, resConfirmed, resCancelled, resWaitlist] = await Promise.all([
            fetch(`${API_BASE_URL}/tours`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/pickups`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/reservations?status=pending`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/reservations?status=confirmed`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/reservations?status=cancelled`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/reservations?status=waitlist`, { headers: getAuthHeaders() })
        ]);

        if (!resTours.ok || !resPick.ok || !resPending.ok || !resConfirmed.ok || !resCancelled.ok || !resWaitlist.ok) {
            throw new Error('API request failed');
        }

        const toursData = await resTours.json();
        const pickupsData = await resPick.json();
        const reservationsPendingData = await resPending.json();
        const reservationsConfirmedData = await resConfirmed.json();
        const reservationsCancelledData = await resCancelled.json();
        const reservationsWaitlistData = await resWaitlist.json();

        cachedTours = (Array.isArray(toursData) ? toursData : []).map(normalizeTour);

        const reservationArrayPending = Array.isArray(reservationsPendingData)
            ? reservationsPendingData
            : (Array.isArray(reservationsPendingData.reservations) ? reservationsPendingData.reservations : []);
        const reservationArrayConfirmed = Array.isArray(reservationsConfirmedData)
            ? reservationsConfirmedData
            : (Array.isArray(reservationsConfirmedData.reservations) ? reservationsConfirmedData.reservations : []);
        const reservationArrayCancelled = Array.isArray(reservationsCancelledData)
            ? reservationsCancelledData
            : (Array.isArray(reservationsCancelledData.reservations) ? reservationsCancelledData.reservations : []);

        cachedReservations = [...reservationArrayPending, ...reservationArrayConfirmed, ...reservationArrayCancelled].map(normalizeReservation);

        const reservationArrayWaitlist = Array.isArray(reservationsWaitlistData)
            ? reservationsWaitlistData
            : (Array.isArray(reservationsWaitlistData.reservations) ? reservationsWaitlistData.reservations : []);
        cachedWaitlist = reservationArrayWaitlist.map(normalizeReservation);

        cachedPickups = (Array.isArray(pickupsData) ? pickupsData : []).map(normalizePickup);
    }

    populateFilterTourDropdown();
    switchTab('reservations');
}

async function refreshData() {
    try {
        await loadInitialData();
        alert('データを更新しました');
    } catch (err) {
        console.error(err);
        alert('データの更新に失敗しました');
    }
}

// フィルター用ツアープルダウンを生成
function populateFilterTourDropdown() {
    const select = document.getElementById('filter-tour-name');
    const currentVal = select.value;
    select.innerHTML = '<option value="">すべてのツアー</option>';
    cachedTours.slice().sort(sortToursByDateAsc).forEach(function(t) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.date + ' ： ' + t.title;
        select.appendChild(opt);
    });
    select.value = currentVal;
}

// ==========================================
// 3. UI操作 (タブ切り替え・モーダル)
// ==========================================
function switchTab(tabId) {
    document.querySelectorAll('.content-view').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-' + tabId).classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    const navMap = { 'reservations': 0, 'tours': 1, 'pickups': 2, 'waitlist': 3, 'settings': 4 };
    document.querySelectorAll('.nav-item')[navMap[tabId]].classList.add('active-nav');

    if (tabId === 'reservations') loadReservations();
    if (tabId === 'tours') loadTours();
    if (tabId === 'pickups') loadPickups();
    if (tabId === 'waitlist') loadWaitlist();
}

async function changePassword() {
    const currentPw = document.getElementById('current-password').value;
    const newPw = document.getElementById('new-password').value;
    const confirmPw = document.getElementById('new-password-confirm').value;
    const msgEl = document.getElementById('password-change-message');
    const btn = document.getElementById('btn-change-password');

    msgEl.classList.add('hidden');

    if (newPw !== confirmPw) {
        msgEl.textContent = '新しいパスワードが一致しません';
        msgEl.className = 'text-sm mt-3 text-center text-red-600';
        msgEl.classList.remove('hidden');
        return;
    }
    if (newPw.length < 4) {
        msgEl.textContent = 'パスワードは4文字以上にしてください';
        msgEl.className = 'text-sm mt-3 text-center text-red-600';
        msgEl.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = '変更中...';
    try {
        const res = await fetch(API_BASE_URL + '/change-password', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
        });
        const data = await res.json();
        if (res.ok) {
            msgEl.textContent = 'パスワードを変更しました';
            msgEl.className = 'text-sm mt-3 text-center text-green-600 font-bold';
            document.getElementById('form-change-password').reset();
        } else {
            msgEl.textContent = data.error === 'invalid_current_password' ? '現在のパスワードが正しくありません' : 'パスワード変更に失敗しました';
            msgEl.className = 'text-sm mt-3 text-center text-red-600';
        }
    } catch (err) {
        msgEl.textContent = '通信エラーが発生しました';
        msgEl.className = 'text-sm mt-3 text-center text-red-600';
    } finally {
        msgEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-key mr-1"></i> パスワードを変更';
    }
}

function openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
    
    if (modalId === 'modal-add-reservation') {
        resetManualReservationForm();
        const select = document.getElementById('manual-tour-id');
        select.innerHTML = '';
        cachedTours.slice().sort(sortToursByDateAsc).forEach(function(t) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.innerText = t.date + ' : ' + t.title + ' (残' + (t.capacity - (t.current || 0)) + ')';
            select.appendChild(opt);
        });
        var pickupContainer = document.getElementById('manual-pickup-checkboxes');
        pickupContainer.innerHTML = '';
        cachedPickups.filter(function(p) { return p.active; }).sort(function(a, b) { return a.sortOrder - b.sortOrder; }).forEach(function(p) {
            var label = document.createElement('label');
            label.className = 'flex items-center gap-2 p-1 rounded hover:bg-gray-100 cursor-pointer';
            label.innerHTML = '<input type="checkbox" value="' + p.name + '" class="manual-pickup-cb w-4 h-4"><span class="text-sm">' + p.name + '</span>';
            pickupContainer.appendChild(label);
        });
    }
    
    if (modalId === 'modal-tour-editor' && !document.getElementById('edit-tour-id').value) {
        document.getElementById('form-tour-editor').reset();
        document.getElementById('edit-tour-id').value = '';
        var allPickupIds = cachedPickups.filter(function(p) { return p.active; }).map(function(p) { return p.id; });
        renderTourPickupCheckboxes(allPickupIds);
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    if (modalId === 'modal-tour-editor') {
        document.getElementById('form-tour-editor').reset();
        document.getElementById('edit-tour-id').value = '';
    }
    if (modalId === 'modal-add-reservation') {
        resetManualReservationForm();
    }
}

function resetManualReservationForm() {
    var form = document.getElementById('form-manual-reservation');
    if (form) form.reset();
    var step1 = document.getElementById('manual-step-1');
    var step2 = document.getElementById('manual-step-2');
    if (step1) step1.classList.remove('hidden');
    if (step2) step2.classList.add('hidden');
    var countInput = document.getElementById('manual-count');
    if (countInput && !countInput.value) countInput.value = '1';
    var totalInput = document.getElementById('manual-confirm-price');
    if (totalInput) totalInput.value = '';
    var summary = document.getElementById('manual-preview-summary');
    if (summary) summary.innerHTML = '';
    var discountRow = document.getElementById('manual-breakdown-discount-row');
    if (discountRow) discountRow.classList.add('hidden');
}

function getManualReservationDraft() {
    var tourId = document.getElementById('manual-tour-id').value;
    var name = document.getElementById('manual-name').value.trim();
    var phone = document.getElementById('manual-phone').value.trim();
    var address = document.getElementById('manual-address').value.trim();
    var count = parseInt(document.getElementById('manual-count').value, 10);
    var pickups = Array.from(document.querySelectorAll('.manual-pickup-cb:checked')).map(function(cb) { return cb.value; });
    var seatPref = document.getElementById('manual-seat-pref').value;
    var specialMember = !!document.getElementById('manual-special-member').checked;
    var tour = cachedTours.find(function(item) { return item.id === tourId; });

    return {
        tourId: tourId,
        tour: tour,
        name: name,
        phone: phone,
        address: address,
        count: count,
        pickups: pickups,
        seatPref: seatPref,
        specialMember: specialMember
    };
}

function calculateManualReservationPrice(draft) {
    if (!draft.tour) return null;
    var baseUnitPrice = Number(draft.tour.price || 0) + MANUAL_PRICE_PLUS_PER_PERSON;
    var baseTotal = baseUnitPrice * draft.count;
    var seatCharge = draft.seatPref === 'あり' ? draft.count * PREFERRED_SEAT_PRICE : 0;
    var discount = draft.specialMember ? draft.count * SPECIAL_MEMBER_DISCOUNT_PER_PERSON : 0;
    var total = Math.max(baseTotal + seatCharge - discount, 0);

    return {
        baseUnitPrice: baseUnitPrice,
        baseTotal: baseTotal,
        seatCharge: seatCharge,
        discount: discount,
        total: total
    };
}

function showManualReservationPreview() {
    var draft = getManualReservationDraft();
    if (!draft.tour) {
        alert('ツアーを選択してください');
        return;
    }
    if (!draft.name) {
        alert('氏名を入力してください');
        return;
    }
    if (!draft.phone) {
        alert('電話番号を入力してください');
        return;
    }
    if (!draft.count || draft.count < 1) {
        alert('人数は1以上にしてください');
        return;
    }
    if (draft.pickups.length === 0) {
        alert('乗車地を1つ以上選択してください');
        return;
    }

    var pricing = calculateManualReservationPrice(draft);
    if (!pricing) {
        alert('金額計算に失敗しました');
        return;
    }

    document.getElementById('manual-preview-summary').innerHTML = ''
        + '<div class="flex justify-between gap-4"><span class="text-gray-500">ツアー</span><span class="font-bold text-right">' + draft.tour.date + ' : ' + draft.tour.title + '</span></div>'
        + '<div class="flex justify-between gap-4"><span class="text-gray-500">氏名</span><span class="font-bold text-right">' + draft.name + '</span></div>'
        + '<div class="flex justify-between gap-4"><span class="text-gray-500">電話番号</span><span class="font-bold text-right">' + draft.phone + '</span></div>'
        + '<div class="flex justify-between gap-4"><span class="text-gray-500">住所</span><span class="font-bold text-right break-all">' + (draft.address || '-') + '</span></div>'
        + '<div class="flex justify-between gap-4"><span class="text-gray-500">人数</span><span class="font-bold text-right">' + draft.count + '名</span></div>'
        + '<div class="flex justify-between gap-4"><span class="text-gray-500">乗車地</span><span class="font-bold text-right">' + draft.pickups.join(' / ') + '</span></div>'
        + '<div class="flex justify-between gap-4"><span class="text-gray-500">前列座席指定</span><span class="font-bold text-right">' + draft.seatPref + '</span></div>'
        + '<div class="flex justify-between gap-4"><span class="text-gray-500">特別会員</span><span class="font-bold text-right">' + (draft.specialMember ? '適用' : 'なし') + '</span></div>';

    document.getElementById('manual-breakdown-base-unit').innerText = '¥' + pricing.baseUnitPrice.toLocaleString();
    document.getElementById('manual-breakdown-base-total').innerText = '¥' + pricing.baseTotal.toLocaleString();
    document.getElementById('manual-breakdown-seat').innerText = '¥' + pricing.seatCharge.toLocaleString();
    document.getElementById('manual-confirm-price').value = pricing.total;

    var discountRow = document.getElementById('manual-breakdown-discount-row');
    var discountValue = document.getElementById('manual-breakdown-discount');
    if (pricing.discount > 0) {
        discountRow.classList.remove('hidden');
        discountValue.innerText = '-¥' + pricing.discount.toLocaleString();
    } else {
        discountRow.classList.add('hidden');
        discountValue.innerText = '-¥0';
    }

    document.getElementById('manual-step-1').classList.add('hidden');
    document.getElementById('manual-step-2').classList.remove('hidden');
}

function backToManualReservationForm() {
    document.getElementById('manual-step-2').classList.add('hidden');
    document.getElementById('manual-step-1').classList.remove('hidden');
}

// CSVダウンロード
function downloadCSV() {
    const filterTourId = document.getElementById('filter-tour-name').value;
    const filterDate = document.getElementById('filter-date').value;
    const filterStatus = document.getElementById('filter-status').value;

    const allReservationsCSV = filterStatus === 'all' || filterStatus === 'waitlist'
        ? [...cachedReservations, ...cachedWaitlist]
        : cachedReservations;

    let filtered = allReservationsCSV.filter(function(r) {
        const matchTour = !filterTourId || r.tour_id === filterTourId;
        const matchDate = !filterDate || r.date === filterDate;
        const matchStatus = filterStatus === 'all' || r.status === filterStatus;
        return matchTour && matchDate && matchStatus;
    });

    const headers = ['ツアー日', 'ツアー名', '氏名', '電話番号', '住所', '人数', '乗車地', '前列座席', '金額', 'ステータス', '進捗'];
    const rows = filtered.map(function(r) {
        const statusLabel = r.status === 'cancelled' ? 'キャンセル' : r.status === 'waitlist' ? 'キャンセル待ち' : r.status === 'pending' ? '予約申込中' : 'ご予約確定';
        const progressLabel = r.progressStatus === 'middle'
            ? '中間'
            : r.progressStatus === 'final'
                ? '最終'
                : r.progressStatus === 'need_check'
                    ? '要確認'
                    : '発送';
        const tourObj = cachedTours.find(function(t) { return t.id === r.tour_id; });
        const tourName = tourObj ? tourObj.title : r.tour_name;
        return [
            r.date,
            tourName,
            r.name,
            r.phone || '',
            r.address || '',
            r.count,
            formatPickupsDisplay(r),
            r.seat_pref || 'なし',
            r.amount,
            statusLabel,
            progressLabel
        ];
    });

    const csvContent = '\uFEFF' + [headers].concat(rows).map(function(row) {
        return row.map(function(cell) {
            const str = String(cell).replace(/"/g, '""');
            return '"' + str + '"';
        }).join(',');
    }).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = toJstDateString(new Date());
    a.href = url;
    a.download = '予約台帳_' + today + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// ==========================================
// 4. 予約台帳機能 (A-02/A-03)
// ==========================================
function loadReservations() {
    const filterTourId = document.getElementById('filter-tour-name').value;
    const filterDate = document.getElementById('filter-date').value;
    const filterStatus = document.getElementById('filter-status').value;

    // waitlistフィルター選択時はcachedWaitlistも含める
    const allReservations = filterStatus === 'all' || filterStatus === 'waitlist'
        ? [...cachedReservations, ...cachedWaitlist]
        : cachedReservations;

    let filtered = allReservations.filter(function(r) {
        const matchTour = !filterTourId || r.tour_id === filterTourId;
        const matchDate = !filterDate || r.date === filterDate;
        const matchStatus = filterStatus === 'all' || r.status === filterStatus;
        return matchTour && matchDate && matchStatus;
    });

    // ソート
    var sortKey = document.getElementById('filter-sort') ? document.getElementById('filter-sort').value : 'createdAt';
    if (sortKey === 'tourDate') {
        filtered.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
    } else if (sortKey === 'status') {
        var statusOrder = { pending: 0, confirmed: 1, waitlist: 2, cancelled: 3 };
        filtered.sort(function(a, b) { return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0); });
    } else if (sortKey === 'pickup') {
        filtered.sort(function(a, b) {
            return formatPickupsDisplay(a).localeCompare(formatPickupsDisplay(b));
        });
    } else {
        filtered.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    }

    let totalPeople = 0;
    let totalSales = 0;
    filtered.forEach(function(r) {
        if (r.status !== 'cancelled' && r.status !== 'waitlist') {
            totalPeople += r.count;
            totalSales += r.amount;
        }
    });
    document.getElementById('summary-people').innerText = totalPeople + '名';
    document.getElementById('summary-sales').innerText = '¥' + totalSales.toLocaleString();

    const tbody = document.getElementById('reservations-table-body');
    tbody.innerHTML = '';
    filtered.forEach(function(r) {
        const tr = document.createElement('tr');
        tr.className = 'cursor-pointer hover:bg-gray-50';
        const statusMeta = getStatusMeta(r.status);
        const latestProgress = getLatestProgressEntry(r);
        const progressMeta = getProgressMeta(latestProgress.status || r.progressStatus);
        // ツアー名はcachedToursから最新を取得
        const tourObj = cachedTours.find(function(t) { return t.id === r.tour_id; });
        const tourName = tourObj ? tourObj.title : r.tour_name;

        const memberMark = r.specialMember ? ' <span class="text-xs text-blue-600 font-bold">★会員</span>' : '';

        tr.innerHTML = '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.date + '</td>'
            + '<td class="p-3 lg:p-4 border-b font-bold text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[220px]">' + tourName + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.name + memberMark + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap text-gray-500">' + (r.lineDisplayName || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.count + '名</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + formatPickupsDisplay(r) + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + (r.seat_pref || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">¥' + r.amount.toLocaleString() + '</td>'
            + '<td class="p-3 lg:p-4 border-b whitespace-nowrap"><span class="px-2 py-1 rounded text-xs font-bold ' + statusMeta.className + '">' + statusMeta.label + '</span></td>'
            + '<td class="p-3 lg:p-4 border-b whitespace-nowrap">'
            + '<div class="inline-flex items-center gap-1">'
            + '<span class="px-2 py-1 rounded text-xs font-bold ' + progressMeta.className + '">' + progressMeta.label + '</span>'
            + '</div>'
            + '</td>'
            + '<td class="p-3 lg:p-4 border-b space-x-1 whitespace-nowrap">'
            + '<button onclick="event.stopPropagation(); showReservationDetail(\'' + r.id + '\')" class="text-blue-600 underline text-xs lg:text-sm">詳細</button>'
            + (r.status !== 'cancelled' ? ' <button onclick="event.stopPropagation(); toggleProgressRecorder(\'' + r.id + '\')" class="text-indigo-600 underline text-xs lg:text-sm">記録</button>' : '')
            + (r.status === 'confirmed' || r.status === 'pending' ? ' <button onclick="event.stopPropagation(); updateReservationStatus(\'' + r.id + '\', \'cancelled\')" class="text-red-600 underline text-xs lg:text-sm">取消</button>' : '')
            + '</td>';
        tr.onclick = function() { showReservationDetail(r.id); };
        tbody.appendChild(tr);

    });

    // ツアー絞り込み時に旅行日・ツアー名列を非表示
    const table = tbody.closest('table');
    const headers = table.querySelectorAll('thead th');
    const rows = table.querySelectorAll('tbody tr');
    
    if (filterTourId) {
        // ツアー選択時は最初の 2 列（ツアー日、ツアー名）を非表示
        headers[0].style.display = 'none';
        headers[1].style.display = 'none';
        rows.forEach(function(row) {
            row.cells[0].style.display = 'none';
            row.cells[1].style.display = 'none';
        });
    } else {
        // ツアー未選択時は表示
        headers[0].style.display = '';
        headers[1].style.display = '';
        rows.forEach(function(row) {
            row.cells[0].style.display = '';
            row.cells[1].style.display = '';
        });
    }
}

function toggleProgressRecorder(id) {
    var r = getReservationById(id);
    if (!r) return;
    document.getElementById('progress-modal-reservation-id').value = id;
    document.getElementById('progress-modal-name').textContent = r.name + '（¥' + r.amount.toLocaleString() + '）';
    var latestProgress = getLatestProgressEntry(r);
    document.getElementById('progress-modal-status').value = latestProgress.status || 'shipping';
    document.getElementById('progress-modal-method').value = getPreferredProgressMethod(r, latestProgress.status || 'shipping');
    document.getElementById('progress-modal-memo').value = getPreferredProgressMemo(r, latestProgress.status || 'shipping');
    document.getElementById('progress-modal-history').innerHTML = buildProgressLogHistoryHtml(r);
    openModal('modal-progress-recorder');
}

function onProgressModalStatusChange() {
    var id = document.getElementById('progress-modal-reservation-id').value;
    var status = document.getElementById('progress-modal-status').value;
    var target = getReservationById(id);
    if (!target) return;
    document.getElementById('progress-modal-method').value = getPreferredProgressMethod(target, status);
    document.getElementById('progress-modal-memo').value = getPreferredProgressMemo(target, status);
}

function onProgressModalMemoInput() {
    var id = document.getElementById('progress-modal-reservation-id').value;
    var target = getReservationById(id);
    if (!target) return;
    var memo = document.getElementById('progress-modal-memo').value;
    savePreferredProgressMemo(target, memo);
}

async function saveProgressFromModal() {
    var id = document.getElementById('progress-modal-reservation-id').value;
    var status = document.getElementById('progress-modal-status').value;
    var method = document.getElementById('progress-modal-method').value;
    var memo = document.getElementById('progress-modal-memo').value.trim();
    var target = getReservationById(id);
    if (!target) return;

    var now = toJstIsoString(new Date());
    var existingLogs = Array.isArray(target.progressLog) ? target.progressLog : [];
    var nextLogs = [{
        status: status,
        method: method,
        memo: memo,
        updatedAt: now
    }].concat(existingLogs);

    if (USE_MOCK) {
        target.progressStatus = status;
        target.progressLog = nextLogs;
        savePreferredProgressMethod(target, method);
        savePreferredProgressMemo(target, memo);
        loadReservations();
        closeModal('modal-progress-recorder');
        return;
    }

    try {
        var res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
            method: 'PATCH',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                progressStatus: status,
                progressLog: nextLogs
            })
        });

        if (!res.ok) {
            var errorBody = await res.json().catch(function() { return {}; });
            alert(errorBody.error || '進捗記録の保存に失敗しました');
            return;
        }

        await loadInitialData();
        loadReservations();
        savePreferredProgressMethod(target, method);
        savePreferredProgressMemo(target, memo);
        // モーダル内の履歴を更新
        var updatedTarget = getReservationById(id);
        if (updatedTarget) {
            document.getElementById('progress-modal-history').innerHTML = buildProgressLogHistoryHtml(updatedTarget);
            document.getElementById('progress-modal-memo').value = getPreferredProgressMemo(updatedTarget, status);
        }
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました');
    }
}

// 予約詳細モーダル
function showReservationDetail(id) {
    const r = cachedReservations.find(function(x) { return x.id === id; }) || cachedWaitlist.find(function(x) { return x.id === id; });
    if (!r) return;
    
    const statusMeta = getStatusMeta(r.status);
    const progressMeta = getProgressMeta(r.progressStatus);
    // ツアー名はcachedToursから最新を取得
    const tourObj = cachedTours.find(function(t) { return t.id === r.tour_id; });
    const tourName = tourObj ? tourObj.title : r.tour_name;
    
    const body = document.getElementById('reservation-detail-body');
    var progressLogsHtml = buildProgressLogHistoryHtml(r);
    var activeProgress = getLatestProgressEntry(r).status || r.progressStatus || 'shipping';
    body.innerHTML = ''
        + '<div class="mb-3 border-b">'
        + '<div class="flex gap-2 text-sm">'
        + '<button type="button" id="detail-tab-btn-info" onclick="switchReservationDetailTab(\'info\')" class="px-3 py-2 font-bold border-b-2 border-primary">予約情報</button>'
        + '<button type="button" id="detail-tab-btn-memo" onclick="switchReservationDetailTab(\'memo\')" class="px-3 py-2 text-gray-600">顧客メモ</button>'
        + '<button type="button" id="detail-tab-btn-state" onclick="switchReservationDetailTab(\'state\')" class="px-3 py-2 text-gray-600">状態管理</button>'
        + '</div>'
        + '</div>'
        + '<div id="detail-tab-info" class="space-y-3">'
        + '<div class="bg-gray-50 rounded-lg p-4 space-y-3 border">'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">状態</span><span class="px-2 py-1 rounded text-xs font-bold ' + statusMeta.className + '">' + statusMeta.label + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">ツアー名</span><span class="font-bold text-sm text-right max-w-[60%]">' + tourName + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">ツアー日</span><span class="font-bold text-sm">' + r.date + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">LINE ID</span><span class="font-bold text-sm text-gray-500 break-all">' + (r.lineUserId || '-') + '</span></div>'
        + '<hr>'
        + '<div><label class="block text-gray-600 text-sm mb-1">氏名</label><input type="text" id="edit-res-name" class="w-full border p-2 rounded text-sm" value="' + (r.name || '').replace(/"/g, '&quot;') + '"></div>'
        + '<div><label class="block text-gray-600 text-sm mb-1">電話番号</label><input type="tel" id="edit-res-phone" class="w-full border p-2 rounded text-sm" value="' + (r.phone || '').replace(/"/g, '&quot;') + '"></div>'
        + '<div><label class="block text-gray-600 text-sm mb-1">住所</label><input type="text" id="edit-res-address" class="w-full border p-2 rounded text-sm" value="' + (r.address || '').replace(/"/g, '&quot;') + '"></div>'
        + '<div><label class="block text-gray-600 text-sm mb-1">人数</label><input type="number" id="edit-res-count" class="w-full border p-2 rounded text-sm" min="1" value="' + r.count + '" oninput="onReservationEditInputsChanged(\'' + r.id + '\')"></div>'
        + '<div>'
        + '<div class="flex items-center justify-between mb-1">'
        + '<label class="block text-gray-600 text-sm">乗車地（複数設定可）</label>'
        + '<div class="flex gap-2">'
        + '<button type="button" onclick="addReservationPickupRow()" class="px-2 py-1 rounded text-xs bg-white border hover:bg-gray-50">+ 行追加</button>'
        + '<button type="button" onclick="fillPickupRowsByCount()" class="px-2 py-1 rounded text-xs bg-white border hover:bg-gray-50">人数分に揃える</button>'
        + '</div>'
        + '</div>'
        + '<div id="edit-res-pickups-container"></div>'
        + '<p class="text-xs text-gray-500 mt-1">複数人で乗車地が異なる場合は行を分けて設定。1人で複数候補を持たせる場合も行追加で登録できます。</p>'
        + '</div>'
        + '<div><label class="block text-gray-600 text-sm mb-1">前列座席指定</label><select id="edit-res-seat" class="w-full border p-2 rounded text-sm bg-white" onchange="onReservationEditInputsChanged(\'' + r.id + '\')"><option value="なし"' + (r.seat_pref !== 'あり' ? ' selected' : '') + '>なし</option><option value="あり"' + (r.seat_pref === 'あり' ? ' selected' : '') + '>あり</option></select></div>'
        + '<div><label class="block text-gray-600 text-sm mb-1">合計金額</label><div class="flex gap-2"><input type="number" id="edit-res-amount" class="w-full border p-2 rounded text-sm" min="0" value="' + r.amount + '"><button type="button" onclick="recalculateReservationAmount(\'' + r.id + '\')" class="px-3 py-2 rounded text-xs bg-gray-100 hover:bg-gray-200 border">自動計算</button></div><p id="edit-res-amount-hint" class="text-xs text-gray-500 mt-1"></p></div>'
        + '<button onclick="saveReservationEdit(\'' + r.id + '\');" class="mt-2 w-full bg-primary hover:bg-primary-hover text-black font-bold py-2 rounded text-sm">予約情報を保存</button>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">特別会員</span><span class="font-bold text-sm">' + (r.specialMember ? '適用中' : '未適用') + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">会員割引</span><span class="font-bold text-sm">-¥' + (r.memberDiscountTotal || 0).toLocaleString() + '</span></div>'
        + '<div class="flex justify-between items-center"><span class="text-gray-600 text-sm">合計金額</span><span class="font-bold text-lg text-red-600">¥' + r.amount.toLocaleString() + '</span></div>'
        + '</div>'
        + '<div class="mt-3 p-3 border rounded bg-white">'
        + '<label class="flex items-center gap-2 text-sm font-bold">'
        + '<input type="checkbox" id="detail-special-member" ' + (r.specialMember ? 'checked' : '') + ' ' + (!r.lineUserId || r.status === 'cancelled' ? 'disabled' : '') + '>'
        + '<span>特別会員（1人あたり300円引き）</span>'
        + '</label>'
        + '<p class="text-xs text-gray-500 mt-1">チェックすると、この予約と同じLINE IDの今後予約にも割引を適用します</p>'
        + (!r.lineUserId ? '<p class="text-xs text-red-500 mt-1">LINE IDが無い予約は特別会員登録できません</p>' : '')
        + (r.status === 'cancelled' ? '<p class="text-xs text-red-500 mt-1">キャンセル済み予約には特別会員を適用できません</p>' : '')
        + '<button onclick="updateSpecialMember(\'' + r.id + '\');" ' + (r.status === 'cancelled' ? 'disabled' : '') + ' class="mt-2 w-full bg-blue-50 hover:bg-blue-100 disabled:bg-gray-100 disabled:text-gray-400 text-blue-700 font-bold py-2 rounded text-sm">会員設定を保存</button>'
        + '</div>'
        + '<div class="mt-3 p-3 border rounded bg-white">'
        + '<label class="block text-sm font-bold mb-2">ステータス変更</label>'
        + '<select id="detail-status-select" class="w-full border p-2 rounded text-sm mb-2">'
        + '<option value="pending"' + (r.status === 'pending' ? ' selected' : '') + '>【予約申込中】</option>'
        + '<option value="confirmed"' + (r.status === 'confirmed' ? ' selected' : '') + '>【ご予約確定】</option>'
        + '<option value="cancelled"' + (r.status === 'cancelled' ? ' selected' : '') + '>【キャンセル】</option>'
        + '<option value="waitlist"' + (r.status === 'waitlist' ? ' selected' : '') + '>【キャンセル待ち】</option>'
        + '</select>'
        + '<button onclick="saveDetailStatus(\'' + r.id + '\');" class="w-full bg-gray-800 hover:bg-gray-700 text-white font-bold py-2 rounded text-sm">ステータスを保存</button>'
        + '</div>'
        + '<div class="mt-3 p-3 border rounded bg-red-50 border-red-200">'
        + '<p class="text-xs text-red-700 mb-2">この操作は取り消せません。予約データを完全に削除します。</p>'
        + '<button onclick="deleteReservationPermanent(\'' + r.id + '\');" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded text-sm">予約を物理削除</button>'
        + '</div>'
        + '</div>'
        + '<div id="detail-tab-memo" class="space-y-3 hidden">'
        + '<div class="mt-3 p-3 border rounded bg-blue-50">'
        + '<label class="block text-sm font-bold mb-2">顧客メモ（LINE IDに紐づく永続メモ）</label>'
        + (r.lineUserId ? '<textarea id="customer-memo-text" class="w-full border p-2 rounded text-sm h-20 resize-none placeholder-gray-400" placeholder="顧客メモを入力（次回予約にも引き継がれます）"></textarea>'
            + '<button onclick="saveCustomerMemo(\'' + r.lineUserId + '\');" class="mt-2 w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 rounded text-sm">顧客メモを保存</button>'
            : '<p class="text-xs text-gray-500">LINE IDが無いため顧客メモは利用できません</p>')
        + '</div>'
        + '<div class="mt-3 p-3 border rounded bg-green-50">'
        + '<label class="block text-sm font-bold mb-2">手動メモ（この予約のみ）</label>'
        + '<textarea id="manual-memo-text" class="w-full border p-2 rounded text-sm h-20 resize-none placeholder-gray-400" placeholder="手動メモを入力（この予約のみ保存）">' + (r.manualMemo || '') + '</textarea>'
        + '<button onclick="saveManualMemo(\'' + r.id + '\');" class="mt-2 w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 rounded text-sm">手動メモを保存</button>'
        + '</div>'
        + '</div>'
        + '<div id="detail-tab-state" class="space-y-3 hidden">'
        + '<div class="p-3 border rounded bg-white">'
        + '<label class="block text-sm font-bold mb-2">最新進捗ステータス</label>'
        + '<select id="detail-progress-status-select" class="w-full border p-2 rounded text-sm mb-2">'
        + '<option value="shipping"' + (activeProgress === 'shipping' ? ' selected' : '') + '>発送</option>'
        + '<option value="middle"' + (activeProgress === 'middle' ? ' selected' : '') + '>中間</option>'
        + '<option value="final"' + (activeProgress === 'final' ? ' selected' : '') + '>最終</option>'
        + '<option value="need_check"' + (activeProgress === 'need_check' ? ' selected' : '') + '>要確認</option>'
        + '</select>'
        + '<button onclick="saveProgressStatusOnly(\'' + r.id + '\')" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded text-sm">進捗ステータスを保存</button>'
        + '</div>'
        + '<div class="p-3 border rounded bg-gray-50">'
        + '<p class="text-sm font-bold mb-2">進捗ログ履歴（新しい順）</p>'
        + '<div>' + progressLogsHtml + '</div>'
        + '</div>';

    openModal('modal-reservation-detail');
    initReservationPickupEditor(r);
    syncReservationAmountByInputs(id, false);
    switchReservationDetailTab('info');
    
    // 顧客メモを非同期で読み込む
    if (r.lineUserId) {
        loadCustomerMemo(r.lineUserId);
    }
}

function switchReservationDetailTab(tabKey) {
    var tabs = ['info', 'memo', 'state'];
    tabs.forEach(function(key) {
        var tabEl = document.getElementById('detail-tab-' + key);
        var btnEl = document.getElementById('detail-tab-btn-' + key);
        if (!tabEl || !btnEl) return;
        if (key === tabKey) {
            tabEl.classList.remove('hidden');
            btnEl.classList.add('font-bold', 'border-b-2', 'border-primary');
            btnEl.classList.remove('text-gray-600');
        } else {
            tabEl.classList.add('hidden');
            btnEl.classList.remove('font-bold', 'border-b-2', 'border-primary');
            btnEl.classList.add('text-gray-600');
        }
    });
}

async function saveProgressStatusOnly(id) {
    var select = document.getElementById('detail-progress-status-select');
    if (!select) return;
    var status = select.value;
    var target = getReservationById(id);
    if (!target) return;

    var logs = Array.isArray(target.progressLog) ? target.progressLog : [];
    var now = toJstIsoString(new Date());
    var nextLogs = [{
        status: status,
        method: getPreferredProgressMethod(target, status),
        memo: getPreferredProgressMemo(target, status) || '状態管理タブから更新',
        updatedAt: now
    }].concat(logs);

    try {
        var res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
            method: 'PATCH',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                progressStatus: status,
                progressLog: nextLogs
            })
        });
        if (!res.ok) {
            var errorBody = await res.json().catch(function() { return {}; });
            alert(errorBody.error || '進捗ステータス更新に失敗しました');
            return;
        }
        await loadInitialData();
        showReservationDetail(id);
        switchReservationDetailTab('state');
        alert('進捗ステータスを更新しました');
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました');
    }
}

// 顧客メモを読み込む
async function loadCustomerMemo(lineUserId) {
    try {
        const res = await fetch(`${API_BASE_URL}/customer-memos/${lineUserId}`, {
            method: 'GET',
            headers: getAuthHeaders()
        });
        
        if (res.ok) {
            const data = await res.json();
            const memoTextarea = document.getElementById('customer-memo-text');
            if (memoTextarea && data.memo) {
                memoTextarea.value = data.memo;
            }
        }
    } catch (err) {
        console.error('Failed to load customer memo:', err);
    }
}

// 顧客メモを保存
async function saveCustomerMemo(lineUserId) {
    if (!lineUserId) {
        alert('LINE IDが無いため保存できません');
        return;
    }
    
    try {
        const memo = document.getElementById('customer-memo-text').value;
        const res = await fetch(`${API_BASE_URL}/customer-memos/${lineUserId}`, {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ memo: memo })
        });
        
        if (res.ok) {
            alert('顧客メモを保存しました');
        } else {
            alert('顧客メモの保存に失敗しました');
        }
    } catch (err) {
        console.error('Failed to save customer memo:', err);
        alert('通信エラーが発生しました');
    }
}

// 手動メモを保存
async function saveManualMemo(reservationId) {
    try {
        const memo = document.getElementById('manual-memo-text').value;
        const res = await fetch(`${API_BASE_URL}/reservations/${reservationId}`, {
            method: 'PATCH',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ manualMemo: memo })
        });
        
        if (res.ok) {
            alert('手動メモを保存しました');
            // キャッシュを更新
            const updated = cachedReservations.find(function(r) { return r.id === reservationId; });
            if (updated) {
                updated.manualMemo = memo;
            }
            // 詳細を再表示
            showReservationDetail(reservationId);
        } else {
            alert('手動メモの保存に失敗しました');
        }
    } catch (err) {
        console.error('Failed to save manual memo:', err);
        alert('通信エラーが発生しました');
    }
}

async function updateReservationProgress(id, progressStatus) {
    if (USE_MOCK) {
        const target = cachedReservations.find(function(r) { return r.id === id; });
        if (target) target.progressStatus = progressStatus;
        loadReservations();
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
            method: 'PATCH',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ progressStatus: progressStatus })
        });

        if (!res.ok) {
            const errorBody = await res.json().catch(() => ({}));
            alert(errorBody.error || '状態更新に失敗しました');
            return;
        }

        await loadInitialData();
        switchTab('reservations');
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました');
    }
}

// 予約ステータス変更 (A-03)
async function updateReservationStatus(id, newStatus) {
    if (!confirm('本当にステータスを変更しますか？')) return;

    if (USE_MOCK) {
        const target = cachedReservations.find(function(r) { return r.id === id; });
        if (target) target.status = newStatus;
        alert('ステータスを更新しました');
        loadReservations();
    } else {
        try {
            const res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
                method: 'PATCH',
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({}));
                alert(errorBody.error || 'ステータス更新に失敗しました');
                return;
            }

            await loadInitialData();
            alert('ステータスを更新しました');
        } catch (err) {
            console.error(err);
            alert('通信エラーが発生しました');
        }
    }
}

async function saveDetailStatus(id) {
    const select = document.getElementById('detail-status-select');
    if (!select) return;
    const newStatus = select.value;
    closeModal('modal-reservation-detail');
    await updateReservationStatus(id, newStatus);
}

function getReservationById(id) {
    return cachedReservations.find(function(x) { return x.id === id; }) || cachedWaitlist.find(function(x) { return x.id === id; }) || null;
}

function calculateReservationAmountForEdit(reservationId, count, seatPref) {
    var reservation = getReservationById(reservationId);
    if (!reservation) return null;

    var tour = cachedTours.find(function(t) { return t.id === reservation.tour_id; });
    var basePerPerson = tour && !isNaN(Number(tour.price)) ? Number(tour.price) : null;

    if (basePerPerson === null) {
        var oldCount = Number(reservation.count || 0);
        var oldSeatCharge = reservation.seat_pref === 'あり' ? oldCount * PREFERRED_SEAT_PRICE : 0;
        var oldDiscount = reservation.specialMember
            ? oldCount * SPECIAL_MEMBER_DISCOUNT_PER_PERSON
            : Number(reservation.memberDiscountTotal || 0);
        var oldBaseTotal = Number(reservation.amount || 0) + oldDiscount - oldSeatCharge;
        basePerPerson = oldCount > 0 ? Math.max(Math.round(oldBaseTotal / oldCount), 0) : 0;
    }

    var seatCharge = seatPref === 'あり' ? count * PREFERRED_SEAT_PRICE : 0;
    var discount = reservation.specialMember ? count * SPECIAL_MEMBER_DISCOUNT_PER_PERSON : 0;
    var total = Math.max((basePerPerson * count) + seatCharge - discount, 0);

    return {
        basePerPerson: basePerPerson,
        seatCharge: seatCharge,
        discount: discount,
        total: total
    };
}

function syncReservationAmountByInputs(reservationId, overwriteAmount) {
    var countInput = document.getElementById('edit-res-count');
    var seatInput = document.getElementById('edit-res-seat');
    var amountInput = document.getElementById('edit-res-amount');
    var hint = document.getElementById('edit-res-amount-hint');
    if (!countInput || !seatInput || !amountInput || !hint) return;

    var count = parseInt(countInput.value, 10);
    if (!count || count < 1) count = 1;
    var seatPref = seatInput.value;
    var calc = calculateReservationAmountForEdit(reservationId, count, seatPref);
    if (!calc) return;

    if (overwriteAmount) {
        amountInput.value = calc.total;
    }

    hint.innerText = '自動計算: 基本 ¥' + calc.basePerPerson.toLocaleString()
        + ' × ' + count
        + ' + 座席 ¥' + calc.seatCharge.toLocaleString()
        + (calc.discount > 0 ? ' - 会員割引 ¥' + calc.discount.toLocaleString() : '')
        + ' = ¥' + calc.total.toLocaleString();
}

function onReservationEditInputsChanged(id) {
    syncReservationAmountByInputs(id, true);
}

function recalculateReservationAmount(id) {
    syncReservationAmountByInputs(id, true);
}

async function saveReservationEdit(id) {
    var nameInput = document.getElementById('edit-res-name');
    var phoneInput = document.getElementById('edit-res-phone');
    var addressInput = document.getElementById('edit-res-address');
    var countInput = document.getElementById('edit-res-count');
    var seatInput = document.getElementById('edit-res-seat');
    var amountInput = document.getElementById('edit-res-amount');

    if (!nameInput || !countInput || !seatInput || !amountInput) {
        alert('編集フォームの読み込みに失敗しました。画面を開き直してください。');
        return;
    }

    var name = nameInput.value.trim();
    var phone = phoneInput ? phoneInput.value.trim() : '';
    var address = addressInput ? addressInput.value.trim() : '';
    var count = parseInt(countInput.value, 10);
    var pickups = getEditedPickupValues();
    var pickup = pickups.length > 0 ? pickups[0] : '';
    var seatPref = seatInput.value;
    var totalPrice = parseInt(amountInput.value, 10);

    if (!name) {
        alert('氏名を入力してください');
        return;
    }
    if (!count || count < 1) {
        alert('人数は1以上で入力してください');
        return;
    }
    if (isNaN(totalPrice) || totalPrice < 0) {
        alert('合計金額は0以上で入力してください');
        return;
    }
    if (pickups.length === 0) {
        alert('乗車地を1件以上選択してください');
        return;
    }

    try {
        var payload = {
            name: name,
            phone: phone,
            address: address,
            passengers: count,
            pickup: pickup,
            pickups: pickups,
            seatPref: seatPref,
            totalPrice: totalPrice
        };

        var res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
            method: 'PATCH',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            var errorBody = await res.json().catch(function() { return {}; });
            alert(errorBody.error || '予約情報の更新に失敗しました');
            return;
        }

        await loadInitialData();
        showReservationDetail(id);
        alert('予約情報を更新しました');
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました');
    }
}

async function updateSpecialMember(id) {
    const checkbox = document.getElementById('detail-special-member');
    if (!checkbox) return;

    const target = cachedReservations.find(function(r) { return r.id === id; }) || cachedWaitlist.find(function(r) { return r.id === id; });
    if (target && target.status === 'cancelled') {
        alert('キャンセル済み予約には特別会員を適用できません');
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
            method: 'PATCH',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ specialMember: checkbox.checked })
        });

        if (!res.ok) {
            const errorBody = await res.json().catch(() => ({}));
            if (errorBody.error === 'cancelled reservation cannot apply special member') {
                alert('キャンセル済み予約には特別会員を適用できません');
            } else {
                alert(errorBody.error || '特別会員の更新に失敗しました');
            }
            return;
        }

        await loadInitialData();
        showReservationDetail(id);
        alert('特別会員設定を更新しました');
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました');
    }
}

async function deleteReservationPermanent(id) {
    var target = cachedReservations.find(function(r) { return r.id === id; }) || cachedWaitlist.find(function(r) { return r.id === id; });
    if (!target) return;

    if (!confirm('この予約を物理削除します。元に戻せません。よろしいですか？')) return;
    if (!confirm('最終確認: 本当に削除しますか？')) return;

    if (USE_MOCK) {
        cachedReservations = cachedReservations.filter(function(r) { return r.id !== id; });
        cachedWaitlist = cachedWaitlist.filter(function(r) { return r.id !== id; });
        closeModal('modal-reservation-detail');
        if (target.status === 'waitlist') {
            switchTab('waitlist');
        } else {
            loadReservations();
        }
        alert('予約を削除しました');
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (!res.ok) {
            const errorBody = await res.json().catch(() => ({}));
            alert(errorBody.error || '予約削除に失敗しました');
            return;
        }

        closeModal('modal-reservation-detail');
        await loadInitialData();
        if (target.status === 'waitlist') {
            switchTab('waitlist');
        } else {
            switchTab('reservations');
        }
        alert('予約を削除しました');
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました');
    }
}

// 手動予約追加 (A-04)
async function submitManualReservation() {
    const draft = getManualReservationDraft();
    const price = parseInt(document.getElementById('manual-confirm-price').value, 10);
    const pricing = calculateManualReservationPrice(draft);

    if (!draft.tour || !pricing) {
        alert('先に金額確認画面へ進んでください');
        return;
    }
    if (!price && price !== 0) {
        alert('合計金額を入力してください');
        return;
    }

    const newRes = {
        id: 'r_manual_' + Date.now(),
        tour_id: draft.tourId,
        tour_name: draft.tour ? draft.tour.title : '',
        date: draft.tour ? draft.tour.date : '',
        name: draft.name,
        phone: draft.phone,
        address: draft.address,
        count: draft.count,
        amount: price,
        status: 'confirmed',
        progressStatus: 'shipping',
        pickup: draft.pickups.join(', '),
        seat_pref: draft.seatPref,
        specialMember: draft.specialMember,
        memberDiscountTotal: pricing.discount
    };

    if (USE_MOCK) {
        cachedReservations.push(newRes);
        alert('予約を追加しました');
        closeModal('modal-add-reservation');
        loadReservations();
    } else {
        if (!draft.tour || !draft.tour.date || !draft.tour.title) {
            alert('ツアー情報の取得に失敗しました。画面を再読み込みしてください。');
            return;
        }

        try {
            const preferredSeats = Array(draft.count).fill(draft.seatPref === 'あり');
            const pickups = draft.pickups.length > 0 ? draft.pickups : [];

            const payload = {
                tour_id: draft.tourId,
                date: draft.tour.date,
                tour_title: draft.tour.title,
                passengers: draft.count,
                user_info: {
                    name: draft.name,
                    phone: draft.phone,
                    pref: '',
                    city: '',
                    street: draft.address
                },
                pickups: pickups,
                preferred_seats: preferredSeats,
                total_price: price,
                special_member: draft.specialMember,
                member_discount_total: pricing.discount
            };

            const res = await fetch(`${API_BASE_URL}/reservations`, {
                method: 'POST',
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({}));
                alert(errorBody.error || '手動予約の登録に失敗しました');
                return;
            }

            closeModal('modal-add-reservation');
            await loadInitialData();
            switchTab('reservations');
            alert('予約を追加しました');
        } catch (err) {
            console.error(err);
            alert('通信エラーが発生しました');
        }
    }
}

// ==========================================
// 5. ツアー管理機能 (A-05)
// ==========================================
function loadTours() {
    const grid = document.getElementById('tours-grid');
    grid.innerHTML = '';

    // 実施日が遠い順にソート
    var sortedTours = cachedTours.slice().sort(function(a, b) {
        return (b.date || '').localeCompare(a.date || '');
    });

    sortedTours.forEach(function(t) {
        const div = document.createElement('div');
        div.className = "bg-white rounded-lg shadow border border-gray-200 p-4 flex flex-col relative";
        
        let statusColor = 'bg-green-100 text-green-800';
        let statusLabel = '受付中';
        if (t.status === 'full') { statusColor = 'bg-red-100 text-red-800'; statusLabel = '満席'; }
        if (t.status === 'waitlist_open') { statusColor = 'bg-orange-100 text-orange-800'; statusLabel = 'キャンセル待ち受付'; }
        if (t.status === 'stop') { statusColor = 'bg-gray-200 text-gray-800'; statusLabel = '受付停止'; }
        if (t.status === 'hidden') { statusColor = 'bg-yellow-100 text-yellow-800'; statusLabel = '非表示'; }
        if (t.status === 'cancelled_tour') { statusColor = 'bg-yellow-100 text-yellow-800'; statusLabel = '中止'; }

        const pickupNames = (t.pickupIds || []).map(function(pid) {
            const p = cachedPickups.find(function(x) { return x.id === pid; });
            return p ? p.name : pid;
        }).join(', ');

        // キャンセル待ち人数を集計
        const waitlistForTour = cachedWaitlist.filter(function(w) { return w.tour_id === t.id; });
        const waitlistCount = waitlistForTour.reduce(function(sum, w) { return sum + w.count; }, 0);
        const waitlistLine = waitlistCount > 0 
            ? '<div class="flex justify-between mb-1"><span class="text-orange-600">キャンセル待ち:</span><span class="font-bold text-orange-600">' + waitlistCount + '名</span></div>'
            : '';

        div.innerHTML = ''
            + '<div class="flex justify-between items-start mb-2">'
            + '<span class="text-xs font-bold px-2 py-1 rounded ' + statusColor + '">' + statusLabel + '</span>'
            + '<span class="text-gray-500 text-sm">' + t.date + '</span>'
            + '</div>'
            + '<h3 class="font-bold text-lg mb-2 truncate lg:whitespace-normal lg:overflow-visible">' + t.title + '</h3>'
            + '<p class="text-xs text-gray-500 mb-2">' + (pickupNames ? '乗車地: ' + pickupNames : '乗車地: 未設定') + '</p>'
            + '<div class="mt-auto pt-4 border-t border-gray-100 text-sm">'
            + '<div class="flex justify-between mb-1"><span>予約数:</span><span class="font-bold">' + (t.current || 0) + ' / ' + t.capacity + '</span></div>'
            + waitlistLine
            + '<div class="flex justify-between mb-3"><span>料金:</span><span>¥' + t.price.toLocaleString() + '</span></div>'
            + '<div class="flex gap-2">'
            + '<button onclick="editTour(\'' + t.id + '\')" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded font-bold text-gray-700 text-sm">編集</button>'
            + '<button onclick="deleteTour(\'' + t.id + '\')" class="bg-red-100 hover:bg-red-200 py-2 px-3 rounded font-bold text-red-600 text-sm"><i class="fa-solid fa-trash"></i></button>'
            + '</div></div>';
        grid.appendChild(div);
    });
}

function renderTourPickupCheckboxes(selectedIds) {
    const container = document.getElementById('edit-tour-pickups');
    container.innerHTML = '';
    const ids = selectedIds || [];
    
    cachedPickups.sort(function(a, b) { return a.sortOrder - b.sortOrder; }).forEach(function(p) {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 p-2 rounded hover:bg-gray-100 cursor-pointer';
        label.innerHTML = '<input type="checkbox" value="' + p.id + '" class="tour-pickup-cb w-4 h-4" ' + (ids.includes(p.id) ? 'checked' : '') + '>'
            + '<span class="text-sm ' + (p.active ? '' : 'text-gray-400 line-through') + '">' + p.name + '</span>'
            + (!p.active ? '<span class="text-xs text-gray-400">(無効)</span>' : '');
        container.appendChild(label);
    });
}

function editTour(id) {
    const t = cachedTours.find(function(x) { return x.id === id; });
    if (!t) return;

    document.getElementById('edit-tour-id').value = t.id;
    document.getElementById('edit-tour-title').value = t.title;
    document.getElementById('edit-tour-date').value = t.date;
    document.getElementById('edit-tour-deadline').value = t.deadline;
    document.getElementById('edit-tour-capacity').value = t.capacity;
    document.getElementById('edit-tour-price').value = t.price;
    document.getElementById('edit-tour-status').value = t.status;
    document.getElementById('edit-tour-desc').value = t.description || '';
    document.getElementById('edit-tour-img').value = t.imageUrl || '';
    
    renderTourPickupCheckboxes(t.pickupIds || []);
    openModal('modal-tour-editor');
}

let _submitTourBusy = false;
async function submitTour() {
    if (_submitTourBusy) return;
    _submitTourBusy = true;
    try { await _submitTourInner(); } finally { _submitTourBusy = false; }
}
async function _submitTourInner() {
    const id = document.getElementById('edit-tour-id').value;
    const title = document.getElementById('edit-tour-title').value;
    const date = document.getElementById('edit-tour-date').value;
    const deadline = document.getElementById('edit-tour-deadline').value;
    const capacity = parseInt(document.getElementById('edit-tour-capacity').value);
    const price = parseInt(document.getElementById('edit-tour-price').value);
    const status = document.getElementById('edit-tour-status').value;
    const description = document.getElementById('edit-tour-desc').value;
    const imageUrl = document.getElementById('edit-tour-img').value;
    
    const pickupIds = Array.from(document.querySelectorAll('.tour-pickup-cb:checked')).map(function(cb) { return cb.value; });

    // 年が4桁を超えていないかチェック
    if (date && date.split('-')[0].length > 4) {
        alert('開催日の年は4桁以内で入力してください。');
        return;
    }
    if (deadline && deadline.split('-')[0].length > 4) {
        alert('締切日の年は4桁以内で入力してください。');
        return;
    }

    // 新規作成時は過去日付を禁止
    if (!id) {
        const today = toJstDateString(new Date());
        if (date < today) {
            alert('過去の日付でツアーを作成することはできません。');
            return;
        }
    }

    // 締切日が開催日より後ならエラー
    if (deadline > date) {
        alert('締切日は開催日より前の日付を設定してください。');
        return;
    }

    // 新規作成時の重複チェック（同じタイトル＋同じ日付）
    if (!id) {
        const dup = cachedTours.find(function(t) { return t.title === title && t.date === date; });
        if (dup) {
            alert('同じツアー名・同じ開催日のツアーが既に存在します。');
            return;
        }
    }

    if (USE_MOCK) {
        if (id) {
            const t = cachedTours.find(function(x) { return x.id === id; });
            if (t) {
                t.title = title; t.date = date; t.deadline = deadline; t.capacity = capacity;
                t.price = price; t.status = status; t.description = description;
                t.imageUrl = imageUrl; t.pickupIds = pickupIds;
            }
            alert('ツアー情報を更新しました');
        } else {
            cachedTours.push({
                id: 't_new_' + Date.now(),
                title: title, date: date, deadline: deadline, capacity: capacity,
                price: price, status: status, description: description,
                imageUrl: imageUrl, pickupIds: pickupIds, current: 0
            });
            alert('新規ツアーを作成しました');
        }
        closeModal('modal-tour-editor');
        document.getElementById('form-tour-editor').reset();
        document.getElementById('edit-tour-id').value = '';
        loadTours();
    } else {
        try {
            const payload = {
                title: title,
                date: date,
                deadline_date: deadline,
                capacity: capacity,
                price: price,
                status: status,
                description: description,
                image_url: imageUrl,
                pickupIds: pickupIds
            };

            const isEdit = !!id;
            const res = await fetch(
                isEdit ? `${API_BASE_URL}/tours/${id}` : `${API_BASE_URL}/tours`,
                {
                    method: isEdit ? 'PATCH' : 'POST',
                    headers: {
                        ...getAuthHeaders(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                }
            );

            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({}));
                alert(errorBody.error || 'ツアー保存に失敗しました');
                return;
            }

            closeModal('modal-tour-editor');
            document.getElementById('form-tour-editor').reset();
            document.getElementById('edit-tour-id').value = '';
            await loadInitialData();
            switchTab('tours');
            alert(isEdit ? 'ツアー情報を更新しました' : '新規ツアーを作成しました');
        } catch (err) {
            console.error(err);
            alert('通信エラーが発生しました');
        }
    }
}

async function deleteTour(id) {
    const t = cachedTours.find(function(x) { return x.id === id; });
    if (!t) return;
    
    if (!confirm('「' + t.title + '」を削除してもよろしいですか？\nこの操作は取り消せません。')) return;

    if (USE_MOCK) {
        cachedTours = cachedTours.filter(function(x) { return x.id !== id; });
        alert('ツアーを削除しました');
        loadTours();
    } else {
        try {
            const res = await fetch(`${API_BASE_URL}/tours/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({}));
                alert(errorBody.error || 'ツアー削除に失敗しました');
                return;
            }

            await loadInitialData();
            switchTab('tours');
            alert('ツアーを削除しました');
        } catch (err) {
            console.error(err);
            alert('通信エラーが発生しました');
        }
    }
}

// ==========================================
// 6. 乗車地管理 (A-06)
// ==========================================
function loadPickups() {
    const tbody = document.getElementById('pickups-table-body');
    tbody.innerHTML = '';
    
    var sorted = cachedPickups.slice().sort(function(a, b) { return a.sortOrder - b.sortOrder; });
    
    sorted.forEach(function(p, idx) {
        const isFirst = idx === 0;
        const isLast = idx === sorted.length - 1;
        const tr = document.createElement('tr');
        tr.innerHTML = '<td class="p-3 lg:p-4 border-b text-center">'
            + '<div class="flex flex-col items-center gap-1">'
            + '<button onclick="movePickup(\'' + p.id + '\', -1)" class="text-gray-400 hover:text-gray-700 text-sm leading-none' + (isFirst ? ' invisible' : '') + '" title="上へ"><i class="fa-solid fa-caret-up text-lg"></i></button>'
            + '<button onclick="movePickup(\'' + p.id + '\', 1)" class="text-gray-400 hover:text-gray-700 text-sm leading-none' + (isLast ? ' invisible' : '') + '" title="下へ"><i class="fa-solid fa-caret-down text-lg"></i></button>'
            + '</div></td>'
            + '<td class="p-3 lg:p-4 border-b font-bold text-sm">' + p.name + '</td>'
            + '<td class="p-3 lg:p-4 border-b">'
            + '<button onclick="togglePickupActive(\'' + p.id + '\')" class="px-3 py-1 rounded text-xs font-bold cursor-pointer transition '
            + (p.active ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200') + '">'
            + (p.active ? '✓ 有効' : '✗ 無効')
            + '</button></td>'
            + '<td class="p-3 lg:p-4 border-b"><button onclick="deletePickup(\'' + p.id + '\')" class="text-red-600 hover:text-red-800 text-sm underline">削除</button></td>';
        tbody.appendChild(tr);
    });
}

async function movePickup(id, direction) {
    var sorted = cachedPickups.slice().sort(function(a, b) { return a.sortOrder - b.sortOrder; });
    var idx = sorted.findIndex(function(p) { return p.id === id; });
    if (idx < 0) return;
    var swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    var current = sorted[idx];
    var target = sorted[swapIdx];
    var tmpOrder = current.sortOrder;
    current.sortOrder = target.sortOrder;
    target.sortOrder = tmpOrder;

    loadPickups();

    if (!USE_MOCK) {
        try {
            await Promise.all([
                fetch(`${API_BASE_URL}/pickups/${current.id}`, {
                    method: 'PATCH',
                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sortOrder: current.sortOrder })
                }),
                fetch(`${API_BASE_URL}/pickups/${target.id}`, {
                    method: 'PATCH',
                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sortOrder: target.sortOrder })
                })
            ]);
        } catch (err) {
            console.error(err);
            alert('並び順の保存に失敗しました');
            await loadInitialData();
            switchTab('pickups');
        }
    }
}

async function togglePickupActive(id) {
    const p = cachedPickups.find(function(x) { return x.id === id; });
    if (!p) return;
    p.active = !p.active;
    if (USE_MOCK) {
        loadPickups();
    } else {
        try {
            const res = await fetch(`${API_BASE_URL}/pickups/${id}`, {
                method: 'PATCH',
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ isActive: p.active })
            });

            if (!res.ok) {
                p.active = !p.active;
                const errorBody = await res.json().catch(() => ({}));
                alert(errorBody.error || '乗車地状態の更新に失敗しました');
                return;
            }

            await loadInitialData();
            switchTab('pickups');
        } catch (err) {
            p.active = !p.active;
            console.error(err);
            alert('通信エラーが発生しました');
        }
    }
}

async function addPickup() {
    const name = document.getElementById('new-pickup-name').value.trim();
    
    if (!name) {
        alert('乗車地名を入力してください');
        return;
    }

    // 重複チェック
    const dup = cachedPickups.find(function(p) { return p.name === name; });
    if (dup) {
        alert('「' + name + '」は既に登録されています。');
        return;
    }
    
    // 新規は末尾に追加
    const maxOrder = cachedPickups.reduce(function(max, p) { return Math.max(max, p.sortOrder || 0); }, 0);
    const sortOrder = maxOrder + 1;
    
    if (USE_MOCK) {
        cachedPickups.push({ id: 'p_new_' + Date.now(), name: name, sortOrder: sortOrder, active: true });
        document.getElementById('new-pickup-name').value = '';
        loadPickups();
    } else {
        try {
            const res = await fetch(`${API_BASE_URL}/pickups`, {
                method: 'POST',
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name,
                    isActive: true,
                    sortOrder: sortOrder
                })
            });

            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({}));
                alert(errorBody.error || '乗車地追加に失敗しました');
                return;
            }

            document.getElementById('new-pickup-name').value = '';
            await loadInitialData();
            switchTab('pickups');
        } catch (err) {
            console.error(err);
            alert('通信エラーが発生しました');
        }
    }
}

async function deletePickup(id) {
    const p = cachedPickups.find(function(x) { return x.id === id; });
    if (!p) return;
    
    if (!confirm('「' + p.name + '」を削除してもよろしいですか？')) return;
    
    if (USE_MOCK) {
        cachedPickups = cachedPickups.filter(function(x) { return x.id !== id; });
        loadPickups();
    } else {
        try {
            const res = await fetch(`${API_BASE_URL}/pickups/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({}));
                alert(errorBody.error || '乗車地削除に失敗しました');
                return;
            }

            await loadInitialData();
            switchTab('pickups');
            alert('乗車地を削除しました');
        } catch (err) {
            console.error(err);
            alert('通信エラーが発生しました');
        }
    }
}

// ==========================================
// 7. キャンセル待ち管理
// ==========================================
function populateFilterWaitlistTourDropdown() {
    const select = document.getElementById('filter-waitlist-tour');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">すべてのツアー</option>';
    cachedTours.slice().sort(sortToursByDateAsc).forEach(function(t) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.date + ' ： ' + t.title;
        select.appendChild(opt);
    });
    select.value = currentVal;
}

function loadWaitlist() {
    populateFilterWaitlistTourDropdown();
    
    const filterTourId = document.getElementById('filter-waitlist-tour').value;

    let filtered = cachedWaitlist.filter(function(r) {
        const matchTour = !filterTourId || r.tour_id === filterTourId;
        return matchTour;
    });

    // 申込日時順にソート（新しい順）
    filtered.sort(function(a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    let totalPeople = 0;
    filtered.forEach(function(r) {
        totalPeople += r.count;
    });
    document.getElementById('waitlist-summary-count').innerText = totalPeople + '名';

    const tbody = document.getElementById('waitlist-table-body');
    tbody.innerHTML = '';
    
    if (filtered.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="8" class="p-6 text-center text-gray-400">キャンセル待ちの予約はありません</td>';
        tbody.appendChild(tr);
        return;
    }

    filtered.forEach(function(r) {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-orange-50';
        
        const createdAt = r.createdAt ? new Date(r.createdAt).toLocaleString('ja-JP') : '-';
        
        tr.innerHTML = '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.date + '</td>'
            + '<td class="p-3 lg:p-4 border-b font-bold text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[220px]">' + r.tour_name + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.name + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap text-gray-500">' + (r.lineDisplayName || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.count + '名</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + (r.phone || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap text-gray-500">' + createdAt + '</td>'
            + '<td class="p-3 lg:p-4 border-b space-x-1 whitespace-nowrap">'
            + '<button onclick="event.stopPropagation(); showReservationDetail(\'' + r.id + '\')" class="text-blue-600 underline text-xs lg:text-sm">詳細</button>'
            + ' <button onclick="event.stopPropagation(); confirmWaitlistReservation(\'' + r.id + '\')" class="text-green-600 underline text-xs lg:text-sm">確定</button>'
            + ' <button onclick="event.stopPropagation(); cancelWaitlistReservation(\'' + r.id + '\')" class="text-red-600 underline text-xs lg:text-sm">取消</button>'
            + '</td>';
        tbody.appendChild(tr);
    });
}

async function confirmWaitlistReservation(id) {
    if (!confirm('このキャンセル待ち予約を「確定」に変更しますか？')) return;
    
    try {
        const res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
            method: 'PATCH',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'confirmed' })
        });

        if (!res.ok) {
            const errorBody = await res.json().catch(() => ({}));
            alert(errorBody.error || 'ステータス更新に失敗しました');
            return;
        }

        await loadInitialData();
        switchTab('waitlist');
        alert('キャンセル待ち予約を確定しました');
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました');
    }
}

async function cancelWaitlistReservation(id) {
    if (!confirm('このキャンセル待ち予約をキャンセルしますか？')) return;
    
    try {
        const res = await fetch(`${API_BASE_URL}/reservations/${id}`, {
            method: 'PATCH',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'cancelled' })
        });

        if (!res.ok) {
            const errorBody = await res.json().catch(() => ({}));
            alert(errorBody.error || 'ステータス更新に失敗しました');
            return;
        }

        await loadInitialData();
        switchTab('waitlist');
        alert('キャンセル待ち予約を取り消しました');
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました');
    }
}

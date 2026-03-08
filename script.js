/**
 * 管理画面ロジック
 * 仕様書に基づき、Cloud Run上の backend-admin API と通信します。
 */

// ==========================================
// 設定・定数
// ==========================================
const USE_MOCK = false;
const API_BASE_URL = "https://backend-admin-482800127304.asia-northeast1.run.app/api/admin";

// 状態管理
let currentAuthToken = null;
let cachedTours = [];
let cachedReservations = [];
let cachedPickups = [];
let cachedWaitlist = [];

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
        count: Number(reservation.count ?? reservation.passengers ?? 0),
        amount: Number(reservation.amount ?? reservation.totalPrice ?? 0),
        status: reservation.status || 'confirmed',
        pickup: reservation.pickup || firstPickup,
        seat_pref: reservation.seat_pref || (hasPreferredSeat ? 'あり' : 'なし'),
        createdAt: reservation.createdAt || ''
    };
}

function getStatusMeta(statusKey) {
    if (statusKey === 'cancelled') return { label: 'キャンセル', className: 'text-red-600 bg-red-50' };
    if (statusKey === 'waitlist') return { label: 'キャンセル待ち', className: 'text-orange-600 bg-orange-50' };
    return { label: '確定', className: 'text-green-600 bg-green-50' };
}

function getProgressMeta(progressKey) {
    if (progressKey === 'middle') return { label: '中間', className: 'text-blue-600 bg-blue-50' };
    if (progressKey === 'final') return { label: '最終', className: 'text-purple-600 bg-purple-50' };
    return { label: '発送', className: 'text-green-600 bg-green-50' };
}

// ==========================================
// 1. 初期化・認証
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
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
        const [resTours, resPick, resConfirmed, resCancelled, resWaitlist] = await Promise.all([
            fetch(`${API_BASE_URL}/tours`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/pickups`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/reservations?status=confirmed`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/reservations?status=cancelled`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/reservations?status=waitlist`, { headers: getAuthHeaders() })
        ]);

        if (!resTours.ok || !resPick.ok || !resConfirmed.ok || !resCancelled.ok || !resWaitlist.ok) {
            throw new Error('API request failed');
        }

        const toursData = await resTours.json();
        const pickupsData = await resPick.json();
        const reservationsConfirmedData = await resConfirmed.json();
        const reservationsCancelledData = await resCancelled.json();
        const reservationsWaitlistData = await resWaitlist.json();

        cachedTours = (Array.isArray(toursData) ? toursData : []).map(normalizeTour);

        const reservationArrayConfirmed = Array.isArray(reservationsConfirmedData)
            ? reservationsConfirmedData
            : (Array.isArray(reservationsConfirmedData.reservations) ? reservationsConfirmedData.reservations : []);
        const reservationArrayCancelled = Array.isArray(reservationsCancelledData)
            ? reservationsCancelledData
            : (Array.isArray(reservationsCancelledData.reservations) ? reservationsCancelledData.reservations : []);

        cachedReservations = [...reservationArrayConfirmed, ...reservationArrayCancelled].map(normalizeReservation);

        const reservationArrayWaitlist = Array.isArray(reservationsWaitlistData)
            ? reservationsWaitlistData
            : (Array.isArray(reservationsWaitlistData.reservations) ? reservationsWaitlistData.reservations : []);
        cachedWaitlist = reservationArrayWaitlist.map(normalizeReservation);

        cachedPickups = (Array.isArray(pickupsData) ? pickupsData : []).map(normalizePickup);
    }

    populateFilterTourDropdown();
    switchTab('reservations');
}

// フィルター用ツアープルダウンを生成
function populateFilterTourDropdown() {
    const select = document.getElementById('filter-tour-name');
    const currentVal = select.value;
    select.innerHTML = '<option value="">すべてのツアー</option>';
    cachedTours.forEach(function(t) {
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
    const navMap = { 'reservations': 0, 'tours': 1, 'pickups': 2, 'waitlist': 3 };
    document.querySelectorAll('.nav-item')[navMap[tabId]].classList.add('active-nav');

    if (tabId === 'reservations') loadReservations();
    if (tabId === 'tours') loadTours();
    if (tabId === 'pickups') loadPickups();
    if (tabId === 'waitlist') loadWaitlist();
}

function openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
    
    if (modalId === 'modal-add-reservation') {
        const select = document.getElementById('manual-tour-id');
        select.innerHTML = '';
        cachedTours.forEach(function(t) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.innerText = t.date + ' : ' + t.title + ' (残' + (t.capacity - (t.current || 0)) + ')';
            select.appendChild(opt);
        });
        const pickupSelect = document.getElementById('manual-pickup');
        pickupSelect.innerHTML = '<option value="">未選択</option>';
        cachedPickups.filter(function(p) { return p.active; }).sort(function(a, b) { return a.sortOrder - b.sortOrder; }).forEach(function(p) {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.innerText = p.name;
            pickupSelect.appendChild(opt);
        });
    }
    
    if (modalId === 'modal-tour-editor' && !document.getElementById('edit-tour-id').value) {
        document.getElementById('form-tour-editor').reset();
        document.getElementById('edit-tour-id').value = '';
        renderTourPickupCheckboxes([]);
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
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
        const statusLabel = r.status === 'cancelled' ? 'キャンセル' : r.status === 'waitlist' ? 'キャンセル待ち' : '確定';
        const progressLabel = r.progressStatus === 'middle' ? '中間' : r.progressStatus === 'final' ? '最終' : '発送';
        const tourObj = cachedTours.find(function(t) { return t.id === r.tour_id; });
        const tourName = tourObj ? tourObj.title : r.tour_name;
        return [
            r.date,
            tourName,
            r.name,
            r.phone || '',
            r.address || '',
            r.count,
            r.pickup || '',
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
    const today = new Date().toISOString().slice(0, 10);
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

    let totalPeople = 0;
    let totalSales = 0;
    filtered.forEach(function(r) {
        if (r.status !== 'cancelled') {
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
        const progressMeta = getProgressMeta(r.progressStatus);
        // ツアー名はcachedToursから最新を取得
        const tourObj = cachedTours.find(function(t) { return t.id === r.tour_id; });
        const tourName = tourObj ? tourObj.title : r.tour_name;

        tr.innerHTML = '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.date + '</td>'
            + '<td class="p-3 lg:p-4 border-b font-bold text-sm">' + tourName + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.name + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap text-gray-500">' + (r.lineDisplayName || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + r.count + '名</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + (r.pickup || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">' + (r.seat_pref || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm whitespace-nowrap">¥' + r.amount.toLocaleString() + '</td>'
            + '<td class="p-3 lg:p-4 border-b whitespace-nowrap"><span class="px-2 py-1 rounded text-xs font-bold ' + statusMeta.className + '">' + statusMeta.label + '</span></td>'
            + '<td class="p-3 lg:p-4 border-b whitespace-nowrap"><span class="px-2 py-1 rounded text-xs font-bold ' + progressMeta.className + '">' + progressMeta.label + '</span></td>'
            + '<td class="p-3 lg:p-4 border-b space-x-1 whitespace-nowrap">'
            + '<button onclick="event.stopPropagation(); showReservationDetail(\'' + r.id + '\')" class="text-blue-600 underline text-xs lg:text-sm">詳細</button>'
            + (r.status !== 'cancelled' ? ' <button onclick="event.stopPropagation(); updateReservationProgress(\'' + r.id + '\', \'shipping\')" class="text-green-600 underline text-xs lg:text-sm">発送</button>' : '')
            + (r.status !== 'cancelled' ? ' <button onclick="event.stopPropagation(); updateReservationProgress(\'' + r.id + '\', \'middle\')" class="text-blue-600 underline text-xs lg:text-sm">中間</button>' : '')
            + (r.status !== 'cancelled' ? ' <button onclick="event.stopPropagation(); updateReservationProgress(\'' + r.id + '\', \'final\')" class="text-purple-600 underline text-xs lg:text-sm">最終</button>' : '')
            + (r.status === 'confirmed' ? ' <button onclick="event.stopPropagation(); updateReservationStatus(\'' + r.id + '\', \'cancelled\')" class="text-red-600 underline text-xs lg:text-sm">取消</button>' : '')
            + '</td>';
        tr.onclick = function() { showReservationDetail(r.id); };
        tbody.appendChild(tr);
    });
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
    body.innerHTML = ''
        + '<div class="bg-gray-50 rounded-lg p-4 space-y-3 border">'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">状態</span><span class="px-2 py-1 rounded text-xs font-bold ' + statusMeta.className + '">' + statusMeta.label + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">ツアー名</span><span class="font-bold text-sm text-right max-w-[60%]">' + tourName + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">ツアー日</span><span class="font-bold text-sm">' + r.date + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">氏名</span><span class="font-bold text-sm">' + r.name + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">LINE ID</span><span class="font-bold text-sm text-gray-500 break-all">' + (r.lineUserId || '-') + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">電話番号</span><span class="font-bold text-sm">' + (r.phone || '-') + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">住所</span><span class="font-bold text-sm text-right max-w-[60%]">' + (r.address || '-') + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">人数</span><span class="font-bold text-sm">' + r.count + '名</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">乗車地</span><span class="font-bold text-sm">' + (r.pickup || '-') + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">前列座席</span><span class="font-bold text-sm">' + (r.seat_pref || '-') + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">備考</span><span class="font-bold text-sm text-right max-w-[60%]"><span class="px-2 py-1 rounded text-xs font-bold ' + progressMeta.className + '">' + progressMeta.label + '</span></span></div>'
        + '<hr>'
        + '<div class="flex justify-between items-center"><span class="text-gray-600 text-sm">合計金額</span><span class="font-bold text-lg text-red-600">¥' + r.amount.toLocaleString() + '</span></div>'
        + '</div>'
        + (r.status === 'confirmed' ? '<div class="mt-4"><button onclick="updateReservationStatus(\'' + r.id + '\', \'cancelled\'); closeModal(\'modal-reservation-detail\')" class="w-full bg-red-100 hover:bg-red-200 text-red-700 font-bold py-2 rounded-lg text-sm transition"><i class="fa-solid fa-ban mr-1"></i> この予約をキャンセルする</button></div>' : '');
    
    openModal('modal-reservation-detail');
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

// 手動予約追加 (A-04)
async function submitManualReservation() {
    const tourId = document.getElementById('manual-tour-id').value;
    const name = document.getElementById('manual-name').value;
    const phone = document.getElementById('manual-phone').value;
    const address = document.getElementById('manual-address').value;
    const count = parseInt(document.getElementById('manual-count').value);
    const price = parseInt(document.getElementById('manual-price').value);
    const pickup = document.getElementById('manual-pickup').value;
    const seatPref = document.getElementById('manual-seat-pref').value;

    const tour = cachedTours.find(function(t) { return t.id === tourId; });
    const newRes = {
        id: 'r_manual_' + Date.now(),
        tour_id: tourId,
        tour_name: tour ? tour.title : '',
        date: tour ? tour.date : '',
        name: name,
        phone: phone,
        address: address,
        count: count,
        amount: price,
        status: 'confirmed',
        progressStatus: 'shipping',
        pickup: pickup,
        seat_pref: seatPref
    };

    if (USE_MOCK) {
        cachedReservations.push(newRes);
        alert('予約を追加しました');
        closeModal('modal-add-reservation');
        document.getElementById('form-manual-reservation').reset();
        loadReservations();
    } else {
        if (!tour || !tour.date || !tour.title) {
            alert('ツアー情報の取得に失敗しました。画面を再読み込みしてください。');
            return;
        }

        try {
            const preferredSeats = Array(count).fill(seatPref === 'あり');
            const pickups = pickup ? Array(count).fill(pickup) : [];

            const payload = {
                tour_id: tourId,
                date: tour.date,
                tour_title: tour.title,
                passengers: count,
                user_info: {
                    name: name,
                    phone: phone,
                    pref: '',
                    city: '',
                    street: address
                },
                pickups: pickups,
                preferred_seats: preferredSeats,
                total_price: price
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
            document.getElementById('form-manual-reservation').reset();
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

    cachedTours.forEach(function(t) {
        const div = document.createElement('div');
        div.className = "bg-white rounded-lg shadow border border-gray-200 p-4 flex flex-col relative";
        
        let statusColor = 'bg-green-100 text-green-800';
        let statusLabel = '受付中';
        if (t.status === 'full') { statusColor = 'bg-red-100 text-red-800'; statusLabel = '満席'; }
        if (t.status === 'stop') { statusColor = 'bg-gray-200 text-gray-800'; statusLabel = '受付停止'; }
        if (t.status === 'hidden') { statusColor = 'bg-yellow-100 text-yellow-800'; statusLabel = '非表示'; }

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
            + '<h3 class="font-bold text-lg mb-2 line-clamp-2">' + t.title + '</h3>'
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
    cachedTours.forEach(function(t) {
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
            + '<td class="p-3 lg:p-4 border-b font-bold text-sm">' + r.tour_name + '</td>'
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

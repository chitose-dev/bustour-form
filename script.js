/**
 * 管理画面ロジック
 * 仕様書に基づき、Cloud Run上の backend-admin API と通信します。
 */

// ==========================================
// 設定・定数
// ==========================================
const USE_MOCK = true;
const API_BASE_URL = "https://your-cloud-run-url-here/api/admin";

// 状態管理
let currentAuthToken = null;
let cachedTours = [];
let cachedReservations = [];
let cachedPickups = [];

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
                alert('認証失敗');
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
    loadInitialData();
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
            { id: 'r1', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '山田 太郎', phone: '090-1234-5678', address: '東京都新宿区西新宿1-1-1', count: 2, amount: 24000, status: 'confirmed', pickup: '新宿駅 西口', seat_pref: 'あり' },
            { id: 'r2', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '佐藤 花子', phone: '080-9876-5432', address: '神奈川県横浜市中区1-2-3', count: 1, amount: 12000, status: 'confirmed', pickup: '横浜駅 東口', seat_pref: 'なし' },
            { id: 'r3', tour_id: 't2', tour_name: '東京湾ナイトクルーズ', date: '2026-03-20', name: '鈴木 一郎', phone: '070-1111-2222', address: '埼玉県さいたま市大宮区3-4-5', count: 4, amount: 32000, status: 'confirmed', pickup: '東京駅 丸の内北口', seat_pref: 'あり' },
            { id: 'r4', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '田中 キャンセル', phone: '090-0000-0000', address: '千葉県千葉市中央区5-6-7', count: 2, amount: 24000, status: 'cancelled', pickup: '新宿駅 西口', seat_pref: 'なし' }
        ];
        cachedPickups = [
            { id: 'p1', name: '新宿駅 西口', sortOrder: 1, active: true },
            { id: 'p2', name: '東京駅 丸の内北口', sortOrder: 2, active: true },
            { id: 'p3', name: '横浜駅 東口', sortOrder: 3, active: true },
            { id: 'p4', name: '大宮駅 西口', sortOrder: 4, active: false }
        ];
    } else {
        const [resTours, resRes, resPick] = await Promise.all([
            fetch(`${API_BASE_URL}/tours`, { headers: { Authorization: currentAuthToken } }),
            fetch(`${API_BASE_URL}/reservations`, { headers: { Authorization: currentAuthToken } }),
            fetch(`${API_BASE_URL}/pickups`, { headers: { Authorization: currentAuthToken } })
        ]);
        cachedTours = await resTours.json();
        cachedReservations = await resRes.json();
        cachedPickups = await resPick.json();
    }

    switchTab('reservations');
}

// ==========================================
// 3. UI操作 (タブ切り替え・モーダル)
// ==========================================
function switchTab(tabId) {
    document.querySelectorAll('.content-view').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-' + tabId).classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    const navMap = { 'reservations': 0, 'tours': 1, 'pickups': 2 };
    document.querySelectorAll('.nav-item')[navMap[tabId]].classList.add('active-nav');

    if (tabId === 'reservations') loadReservations();
    if (tabId === 'tours') loadTours();
    if (tabId === 'pickups') loadPickups();
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
    
    if (modalId === 'modal-tour-editor') {
        renderTourPickupCheckboxes();
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

// ==========================================
// 4. 予約台帳機能 (A-02/A-03)
// ==========================================
function loadReservations() {
    const filterName = document.getElementById('filter-tour-name').value.toLowerCase();
    const filterDate = document.getElementById('filter-date').value;
    const filterStatus = document.getElementById('filter-status').value;

    let filtered = cachedReservations.filter(function(r) {
        const matchName = !filterName || r.tour_name.toLowerCase().includes(filterName);
        const matchDate = !filterDate || r.date === filterDate;
        const matchStatus = filterStatus === 'all' || r.status === filterStatus;
        return matchName && matchDate && matchStatus;
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
        const statusClass = r.status === 'confirmed' ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50';
        const statusLabel = r.status === 'confirmed' ? '確定' : 'キャンセル';

        tr.innerHTML = '<td class="p-3 lg:p-4 border-b font-mono text-xs lg:text-sm">' + r.id + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm">' + r.date + '</td>'
            + '<td class="p-3 lg:p-4 border-b font-bold text-sm">' + r.tour_name + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm">' + r.name + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm">' + r.count + '名</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm">' + (r.pickup || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm">' + (r.seat_pref || '-') + '</td>'
            + '<td class="p-3 lg:p-4 border-b text-sm">¥' + r.amount.toLocaleString() + '</td>'
            + '<td class="p-3 lg:p-4 border-b"><span class="px-2 py-1 rounded text-xs font-bold ' + statusClass + '">' + statusLabel + '</span></td>'
            + '<td class="p-3 lg:p-4 border-b space-x-1 whitespace-nowrap">'
            + '<button onclick="event.stopPropagation(); showReservationDetail(\'' + r.id + '\')" class="text-blue-600 underline text-xs lg:text-sm">詳細</button>'
            + (r.status === 'confirmed' ? ' <button onclick="event.stopPropagation(); updateReservationStatus(\'' + r.id + '\', \'cancelled\')" class="text-red-600 underline text-xs lg:text-sm">取消</button>' : '')
            + '</td>';
        tr.onclick = function() { showReservationDetail(r.id); };
        tbody.appendChild(tr);
    });
}

// 予約詳細モーダル
function showReservationDetail(id) {
    const r = cachedReservations.find(function(x) { return x.id === id; });
    if (!r) return;
    
    const statusClass = r.status === 'confirmed' ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50';
    const statusLabel = r.status === 'confirmed' ? '確定' : 'キャンセル';
    
    const body = document.getElementById('reservation-detail-body');
    body.innerHTML = ''
        + '<div class="flex justify-between items-center mb-2">'
        + '<span class="text-gray-500 text-sm">予約ID</span>'
        + '<span class="font-mono text-sm">' + r.id + '</span>'
        + '</div>'
        + '<div class="bg-gray-50 rounded-lg p-4 space-y-3 border">'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">ステータス</span><span class="px-2 py-1 rounded text-xs font-bold ' + statusClass + '">' + statusLabel + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">ツアー名</span><span class="font-bold text-sm text-right max-w-[60%]">' + r.tour_name + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">ツアー日</span><span class="font-bold text-sm">' + r.date + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">氏名</span><span class="font-bold text-sm">' + r.name + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">電話番号</span><span class="font-bold text-sm">' + (r.phone || '-') + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">住所</span><span class="font-bold text-sm text-right max-w-[60%]">' + (r.address || '-') + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">人数</span><span class="font-bold text-sm">' + r.count + '名</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">乗車地</span><span class="font-bold text-sm">' + (r.pickup || '-') + '</span></div>'
        + '<div class="flex justify-between"><span class="text-gray-600 text-sm">前列座席</span><span class="font-bold text-sm">' + (r.seat_pref || '-') + '</span></div>'
        + '<hr>'
        + '<div class="flex justify-between items-center"><span class="text-gray-600 text-sm">合計金額</span><span class="font-bold text-lg text-red-600">¥' + r.amount.toLocaleString() + '</span></div>'
        + '</div>'
        + (r.status === 'confirmed' ? '<div class="mt-4"><button onclick="updateReservationStatus(\'' + r.id + '\', \'cancelled\'); closeModal(\'modal-reservation-detail\')" class="w-full bg-red-100 hover:bg-red-200 text-red-700 font-bold py-2 rounded-lg text-sm transition"><i class="fa-solid fa-ban mr-1"></i> この予約をキャンセルする</button></div>' : '');
    
    openModal('modal-reservation-detail');
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
        // PATCH /reservations/{id}
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
        // POST /reservations
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
        if (t.status === 'full') statusColor = 'bg-red-100 text-red-800';
        if (t.status === 'stop') statusColor = 'bg-gray-200 text-gray-800';
        if (t.status === 'hidden') statusColor = 'bg-yellow-100 text-yellow-800';

        const pickupNames = (t.pickupIds || []).map(function(pid) {
            const p = cachedPickups.find(function(x) { return x.id === pid; });
            return p ? p.name : pid;
        }).join(', ');

        div.innerHTML = ''
            + '<div class="flex justify-between items-start mb-2">'
            + '<span class="text-xs font-bold px-2 py-1 rounded ' + statusColor + '">' + t.status.toUpperCase() + '</span>'
            + '<span class="text-gray-500 text-sm">' + t.date + '</span>'
            + '</div>'
            + '<h3 class="font-bold text-lg mb-2 line-clamp-2">' + t.title + '</h3>'
            + '<p class="text-xs text-gray-500 mb-2">' + (pickupNames ? '乗車地: ' + pickupNames : '乗車地: 未設定') + '</p>'
            + '<div class="mt-auto pt-4 border-t border-gray-100 text-sm">'
            + '<div class="flex justify-between mb-1"><span>予約数:</span><span class="font-bold">' + (t.current || 0) + ' / ' + t.capacity + '</span></div>'
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

function submitTour() {
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
        // PUT or POST /tours
    }
}

function deleteTour(id) {
    const t = cachedTours.find(function(x) { return x.id === id; });
    if (!t) return;
    
    if (!confirm('「' + t.title + '」を削除してもよろしいですか？\nこの操作は取り消せません。')) return;

    if (USE_MOCK) {
        cachedTours = cachedTours.filter(function(x) { return x.id !== id; });
        alert('ツアーを削除しました');
        loadTours();
    }
}

// ==========================================
// 6. 乗車地管理 (A-06)
// ==========================================
function loadPickups() {
    const tbody = document.getElementById('pickups-table-body');
    tbody.innerHTML = '';
    
    var sorted = cachedPickups.slice().sort(function(a, b) { return a.sortOrder - b.sortOrder; });
    
    sorted.forEach(function(p) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td class="p-3 lg:p-4 border-b text-sm text-center">' + p.sortOrder + '</td>'
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

function togglePickupActive(id) {
    const p = cachedPickups.find(function(x) { return x.id === id; });
    if (!p) return;
    p.active = !p.active;
    if (USE_MOCK) {
        loadPickups();
    }
}

function addPickup() {
    const name = document.getElementById('new-pickup-name').value.trim();
    const sortInput = document.getElementById('new-pickup-sort');
    const sortOrder = sortInput ? parseInt(sortInput.value) || (cachedPickups.length + 1) : (cachedPickups.length + 1);
    
    if (!name) {
        alert('乗車地名を入力してください');
        return;
    }
    
    cachedPickups.push({ id: 'p_new_' + Date.now(), name: name, sortOrder: sortOrder, active: true });
    document.getElementById('new-pickup-name').value = '';
    if (sortInput) sortInput.value = '';
    loadPickups();
}

function deletePickup(id) {
    const p = cachedPickups.find(function(x) { return x.id === id; });
    if (!p) return;
    
    if (!confirm('「' + p.name + '」を削除してもよろしいですか？')) return;
    
    cachedPickups = cachedPickups.filter(function(x) { return x.id !== id; });
    loadPickups();
}

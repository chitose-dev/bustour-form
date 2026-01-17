/**
 * 管理画面ロジック
 * 仕様書に基づき、Cloud Run上の backend-admin API と通信します。
 */

// ==========================================
// 設定・定数
// ==========================================
// trueの場合、APIを呼ばずにメモリ内のダミーデータを使用します (動作確認用)
const USE_MOCK = true;

// 本番環境のAPIベースURL (Cloud RunのURLに置き換えてください)
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
    // ログインフォームのイベントハンドラ
    document.getElementById('login-form').addEventListener('submit', handleLogin);
});

async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById('login-password').value;

    if (USE_MOCK) {
        // モック認証 (パスワード 'admin' で成功)
        if (password === 'admin') {
            loginSuccess('mock-token-123');
        } else {
            alert('パスワードが違います');
        }
    } else {
        [cite_start]// 本番認証 API呼び出し [cite: 300]
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
    
    // 初期データロード
    loadInitialData();
}

function logout() {
    location.reload();
}

// ==========================================
// 2. データ取得・表示ロジック
// ==========================================

async function loadInitialData() {
    if (USE_MOCK) {
        // ダミーデータ生成
        cachedTours = [
            { id: 't1', title: '春の九州・温泉めぐり', date: '2026-03-15', capacity: 40, price: 12000, status: 'open', deadline: '2026-03-10', current: 15 },
            { id: 't2', title: '東京湾ナイトクルーズ', date: '2026-03-20', capacity: 20, price: 8000, status: 'full', deadline: '2026-03-18', current: 20 },
            { id: 't3', title: '富士山日帰りバス', date: '2026-04-01', capacity: 45, price: 10000, status: 'stop', deadline: '2026-03-30', current: 0 }
        ];
        cachedReservations = [
            { id: 'r1', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '山田 太郎', count: 2, amount: 24000, status: 'confirmed' },
            { id: 'r2', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '佐藤 花子', count: 1, amount: 12000, status: 'confirmed' },
            { id: 'r3', tour_id: 't2', tour_name: '東京湾ナイトクルーズ', date: '2026-03-20', name: '鈴木 一郎', count: 4, amount: 32000, status: 'confirmed' },
            { id: 'r4', tour_id: 't1', tour_name: '春の九州・温泉めぐり', date: '2026-03-15', name: '田中 キャンセル', count: 2, amount: 24000, status: 'cancelled' }
        ];
        cachedPickups = [
            { id: 'p1', name: '新宿駅 西口', active: true },
            { id: 'p2', name: '東京駅 丸の内北口', active: true }
        ];
    } else {
        // APIから並行取得
        [cite_start]// [cite: 300] GET /tours, GET /reservations, GET /pickups
        const [resTours, resRes, resPick] = await Promise.all([
            fetch(`${API_BASE_URL}/tours`, { headers: { Authorization: currentAuthToken } }),
            fetch(`${API_BASE_URL}/reservations`, { headers: { Authorization: currentAuthToken } }),
            fetch(`${API_BASE_URL}/pickups`, { headers: { Authorization: currentAuthToken } })
        ]);
        cachedTours = await resTours.json();
        cachedReservations = await resRes.json();
        cachedPickups = await resPick.json();
    }

    // 初期表示
    switchTab('reservations');
}

// ==========================================
// 3. UI操作 (タブ切り替え・モーダル)
// ==========================================

function switchTab(tabId) {
    // コンテンツ表示切り替え
    document.querySelectorAll('.content-view').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${tabId}`).classList.remove('hidden');

    // ナビゲーションのアクティブ化
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    // 簡易的にindexで指定（本来はID判定推奨）
    const navMap = { 'reservations': 0, 'tours': 1, 'pickups': 2 };
    document.querySelectorAll('.nav-item')[navMap[tabId]].classList.add('active-nav');

    // データ再描画
    if (tabId === 'reservations') loadReservations();
    if (tabId === 'tours') loadTours();
    if (tabId === 'pickups') loadPickups();
}

function openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
    // 手動予約時はツアー選択肢を更新
    if (modalId === 'modal-add-reservation') {
        const select = document.getElementById('manual-tour-id');
        select.innerHTML = '';
        cachedTours.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.innerText = `${t.date} : ${t.title} (残${t.capacity - (t.current || 0)})`;
            select.appendChild(opt);
        });
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

// ==========================================
[cite_start]// 4. 予約台帳機能 [cite: 119-122]
// ==========================================

function loadReservations() {
    const filterName = document.getElementById('filter-tour-name').value.toLowerCase();
    const filterDate = document.getElementById('filter-date').value;
    const filterStatus = document.getElementById('filter-status').value;

    // フィルタリング
    let filtered = cachedReservations.filter(r => {
        const matchName = !filterName || r.tour_name.toLowerCase().includes(filterName);
        const matchDate = !filterDate || r.date === filterDate;
        const matchStatus = filterStatus === 'all' || r.status === filterStatus;
        return matchName && matchDate && matchStatus;
    });

    [cite_start]// 集計 [cite: 116-118]
    let totalPeople = 0;
    let totalSales = 0;
    filtered.forEach(r => {
        if (r.status !== 'cancelled') {
            totalPeople += r.count;
            totalSales += r.amount;
        }
    });
    document.getElementById('summary-people').innerText = `${totalPeople}名`;
    document.getElementById('summary-sales').innerText = `¥${totalSales.toLocaleString()}`;

    // テーブル描画
    const tbody = document.getElementById('reservations-table-body');
    tbody.innerHTML = '';
    filtered.forEach(r => {
        const tr = document.createElement('tr');
        const statusClass = r.status === 'confirmed' ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50';
        const statusLabel = r.status === 'confirmed' ? '確定' : 'キャンセル';

        tr.innerHTML = `
            <td class="p-4 border-b font-mono text-sm">${r.id}</td>
            <td class="p-4 border-b">${r.date}</td>
            <td class="p-4 border-b font-bold">${r.tour_name}</td>
            <td class="p-4 border-b">${r.name}</td>
            <td class="p-4 border-b">${r.count}名</td>
            <td class="p-4 border-b">¥${r.amount.toLocaleString()}</td>
            <td class="p-4 border-b"><span class="px-2 py-1 rounded text-sm font-bold ${statusClass}">${statusLabel}</span></td>
            <td class="p-4 border-b">
                ${r.status === 'confirmed' ? `<button onclick="updateReservationStatus('${r.id}', 'cancelled')" class="text-red-600 underline text-sm">キャンセル</button>` : '-'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 予約ステータス変更 (A-03)
async function updateReservationStatus(id, newStatus) {
    if (!confirm('本当にステータスを変更しますか？')) return;

    if (USE_MOCK) {
        const target = cachedReservations.find(r => r.id === id);
        if (target) target.status = newStatus;
        alert('ステータスを更新しました');
        loadReservations();
    } else {
        [cite_start]// [cite: 300] PATCH /reservations/{id}
        // fetch...
    }
}

// 手動予約追加 (A-04)
async function submitManualReservation() {
    const tourId = document.getElementById('manual-tour-id').value;
    const name = document.getElementById('manual-name').value;
    const count = parseInt(document.getElementById('manual-count').value);
    const price = parseInt(document.getElementById('manual-price').value);

    const newRes = {
        id: 'r_manual_' + Date.now(),
        tour_id: tourId,
        tour_name: cachedTours.find(t => t.id === tourId).title,
        date: cachedTours.find(t => t.id === tourId).date,
        name: name,
        count: count,
        amount: price,
        status: 'confirmed'
    };

    if (USE_MOCK) {
        cachedReservations.push(newRes);
        alert('予約を追加しました');
        closeModal('modal-add-reservation');
        loadReservations();
    } else {
        [cite_start]// [cite: 300] POST /reservations
        // fetch...
    }
}

// ==========================================
// 5. ツアー管理機能 (A-05)
// ==========================================

function loadTours() {
    const grid = document.getElementById('tours-grid');
    grid.innerHTML = '';

    cachedTours.forEach(t => {
        const div = document.createElement('div');
        div.className = "bg-white rounded-lg shadow border border-gray-200 p-4 flex flex-col relative";
        
        let statusColor = 'bg-green-100 text-green-800';
        if (t.status === 'full') statusColor = 'bg-red-100 text-red-800';
        if (t.status === 'stop') statusColor = 'bg-gray-200 text-gray-800';

        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <span class="text-xs font-bold px-2 py-1 rounded ${statusColor}">${t.status.toUpperCase()}</span>
                <span class="text-gray-500 text-sm">${t.date}</span>
            </div>
            <h3 class="font-bold text-lg mb-2 line-clamp-2">${t.title}</h3>
            <div class="mt-auto pt-4 border-t border-gray-100 text-sm">
                <div class="flex justify-between mb-1">
                    <span>予約数:</span>
                    <span class="font-bold">${t.current || 0} / ${t.capacity}</span>
                </div>
                <div class="flex justify-between mb-2">
                    <span>料金:</span>
                    <span>¥${t.price.toLocaleString()}</span>
                </div>
                <button onclick="editTour('${t.id}')" class="w-full bg-gray-100 hover:bg-gray-200 py-2 rounded font-bold text-gray-700">編集</button>
            </div>
        `;
        grid.appendChild(div);
    });
}

function editTour(id) {
    const t = cachedTours.find(x => x.id === id);
    if (!t) return;

    // フォームに値をセット
    document.getElementById('edit-tour-id').value = t.id;
    document.getElementById('edit-tour-title').value = t.title;
    document.getElementById('edit-tour-date').value = t.date;
    document.getElementById('edit-tour-deadline').value = t.deadline;
    document.getElementById('edit-tour-capacity').value = t.capacity;
    document.getElementById('edit-tour-price').value = t.price;
    document.getElementById('edit-tour-status').value = t.status;
    
    openModal('modal-tour-editor');
}

function submitTour() {
    // ツアー保存処理 (省略: Mock時はcachedToursを更新)
    alert('ツアー情報を保存しました(Mock)');
    closeModal('modal-tour-editor');
    loadTours();
}

// ==========================================
// 6. 乗車地管理 (A-06)
// ==========================================

function loadPickups() {
    const tbody = document.getElementById('pickups-table-body');
    tbody.innerHTML = '';
    
    cachedPickups.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="p-4 border-b font-bold">${p.name}</td>
            <td class="p-4 border-b">
                <span class="px-2 py-1 rounded text-xs ${p.active ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'}">
                    ${p.active ? '有効' : '無効'}
                </span>
            </td>
            <td class="p-4 border-b">
                <button class="text-blue-600 underline text-sm">編集</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addPickup() {
    const name = document.getElementById('new-pickup-name').value;
    if (!name) return;
    
    cachedPickups.push({ id: 'p_new', name: name, active: true });
    document.getElementById('new-pickup-name').value = '';
    loadPickups();
}
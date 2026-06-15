/**
 * ====================================================================
 * Frontend Logic & Client-Server Integration
 * PT Graha Prima Mentari Warehouse Administration System
 * Express.js API & Supabase PostgreSQL Integration
 * ====================================================================
 */

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:'
    ? 'http://localhost:5000/api'
    : '/api';

// Active session info
let currentSession = null;

// Global charts variables
let chartKategoriInstance = null;
let chartMutasiInstance = null;

// Temporary checklist database for outbound form
let tempOutboundChecklist = [];

// ==========================================
// 1. API HELPER FUNCTION
// ==========================================

async function apiFetch(endpoint, options = {}) {
    const token = sessionStorage.getItem('active_token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers
        });

        if (response.status === 401 || response.status === 403) {
            // Token expired or invalid
            sessionStorage.removeItem('active_session');
            sessionStorage.removeItem('active_token');
            currentSession = null;
            showLoginOverlay();
            throw new Error('Sesi Anda telah berakhir. Silakan login kembali.');
        }

        const data = await response.json();
        if (!response.ok) {
            console.error("DEBUG API ERROR:", data);
            throw new Error((data.error ? `${data.message} (${data.error})` : data.message) || 'Terjadi kesalahan pada sistem.');
        }

        return data;
    } catch (err) {
        console.error(`API Error on ${endpoint}:`, err);
        throw err;
    }
}

// ==========================================
// 2. RUNTIME INITS & DOM EVENT LISTENERS
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // Check session
    const savedSession = sessionStorage.getItem('active_session');
    if (savedSession) {
        currentSession = JSON.parse(savedSession);
        loginUser(currentSession);
    } else {
        showLoginOverlay();
    }

    // Login Form Submit
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();

        try {
            const data = await apiFetch('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });

            currentSession = {
                id: data.user.id,
                username: data.user.username,
                role: data.user.role,
                nama: data.user.nama_lengkap
            };

            sessionStorage.setItem('active_token', data.token);
            sessionStorage.setItem('active_session', JSON.stringify(currentSession));
            loginUser(currentSession);
        } catch (err) {
            alert(err.message || 'Username atau password salah!');
        }
    });

    // Quick Role Switcher Action (Auto login to demo account for smooth experience)
    const quickRoleSelect = document.getElementById('quick-role-select');
    if (quickRoleSelect) {
        quickRoleSelect.addEventListener('change', async (e) => {
            if (!currentSession) return;
            const newRole = e.target.value;
            const credentials = newRole === 'Pimpinan'
                ? { username: 'pimpinan', password: 'pimpinan123' }
                : newRole === 'Pengantar Barang'
                    ? { username: 'driver', password: 'admin123' }
                    : { username: 'admin', password: 'admin123' };

            try {
                const data = await apiFetch('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify(credentials)
                });

                currentSession = {
                    id: data.user.id,
                    username: data.user.username,
                    role: data.user.role,
                    nama: data.user.nama_lengkap
                };

                sessionStorage.setItem('active_token', data.token);
                sessionStorage.setItem('active_session', JSON.stringify(currentSession));

                // Set text elements
                document.getElementById('sidebar-user-name').innerText = currentSession.nama;
                document.getElementById('sidebar-user-role').innerText = currentSession.role;
                document.getElementById('badge-user-name').innerText = currentSession.nama;
                document.getElementById('badge-user-role').innerText = currentSession.role === 'Admin Gudang' ? 'Admin' : 'Pimpinan';
                document.getElementById('user-avatar-initial').innerText = currentSession.nama.charAt(0);

                applyRoleConstraints();
                renderActivePanel();
            } catch (err) {
                alert('Gagal berganti mode pengujian: ' + err.message);
            }
        });
    }

    // Mobile sidebar toggle, close button, and backdrop logic
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    function toggleMobileSidebar() {
        if (sidebar && backdrop) {
            const isOpen = sidebar.classList.toggle('open');
            backdrop.classList.toggle('hidden');

            // Toggle body & html scrolling prevention
            if (isOpen) {
                document.body.classList.add('no-scroll');
                document.documentElement.classList.add('no-scroll');
                sidebar.scrollTop = 0; // Reset scroll position to top
            } else {
                document.body.classList.remove('no-scroll');
                document.documentElement.classList.remove('no-scroll');
            }
        }
    }

    document.getElementById('mobile-sidebar-toggle')?.addEventListener('click', toggleMobileSidebar);
    document.getElementById('sidebar-close-btn')?.addEventListener('click', toggleMobileSidebar);
    backdrop?.addEventListener('click', toggleMobileSidebar);

    // Sidebar navigation clicks
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPanel = item.getAttribute('data-target');
            switchPanel(targetPanel);

            // Close sidebar on mobile after choosing a menu item
            if (sidebar && sidebar.classList.contains('open')) {
                toggleMobileSidebar();
            }
        });
    });

    // Logout click
    document.getElementById('logout-button').addEventListener('click', () => {
        sessionStorage.removeItem('active_session');
        sessionStorage.removeItem('active_token');
        currentSession = null;
        showLoginOverlay();
    });

    // --- FORM SUBMITS ---

    // 1. Master Barang Form
    document.getElementById('form-barang').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (currentSession.role !== 'Admin Gudang') return alert('Hak Akses Ditolak!');

        const barangId = document.getElementById('barang-id').value;
        const sku = document.getElementById('barang-sku').value.trim().toUpperCase();
        const nama = document.getElementById('barang-nama').value.trim();
        const kategori = document.getElementById('barang-kategori').value;
        const harga = parseFloat(document.getElementById('barang-harga').value);
        const stokMin = parseInt(document.getElementById('barang-stok-min').value);
        const stokAwal = parseInt(document.getElementById('barang-stok-awal').value) || 0;

        try {
            if (barangId) {
                // EDIT EXISTING
                await apiFetch(`/barang/${barangId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        nama_barang: nama,
                        kategori,
                        stok_minimum: stokMin,
                        harga
                    })
                });
                alert('Barang berhasil diperbarui');
            } else {
                // ADD NEW
                await apiFetch('/barang', {
                    method: 'POST',
                    body: JSON.stringify({
                        kode_barang: sku,
                        nama_barang: nama,
                        kategori,
                        harga,
                        stok_minimum: stokMin,
                        stok_sekarang: stokAwal
                    })
                });

                // Record transaction initial stock if greater than 0
                if (stokAwal > 0) {
                    // Note: The backend automatically sets initial stock on creation, but we can log it.
                }
                alert('Barang baru berhasil ditambahkan');
            }

            resetBarangForm();
            renderBarangPanel();
        } catch (err) {
            alert('Gagal menyimpan barang: ' + err.message);
        }
    });

    document.getElementById('btn-batal-barang').addEventListener('click', resetBarangForm);

    // 2. Inbound Form (Barang Masuk)
    document.getElementById('form-inbound').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (currentSession.role !== 'Admin Gudang') return alert('Hak Akses Ditolak!');

        const inboundId = document.getElementById('inbound-id').value;
        const noTx = document.getElementById('inbound-no-transaksi').value;
        const barangId = parseInt(document.getElementById('inbound-barang').value);
        const qty = parseInt(document.getElementById('inbound-qty').value);
        const keterangan = document.getElementById('inbound-keterangan').value.trim() || 'Restok barang';

        if (!barangId || qty <= 0) return alert('Data input tidak valid!');

        try {
            if (inboundId) {
                // EDIT EXISTING
                await apiFetch(`/transaksi/${inboundId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        keterangan,
                        detail_items: [
                            { barang_id: barangId, jumlah: qty }
                        ]
                    })
                });
                alert(`Sukses memperbarui transaksi masuk!`);
                resetInboundForm();
            } else {
                // ADD NEW
                await apiFetch('/transaksi', {
                    method: 'POST',
                    body: JSON.stringify({
                        jenis_transaksi: 'IN',
                        nomor_transaksi: noTx,
                        keterangan,
                        detail_items: [
                            { barang_id: barangId, jumlah: qty }
                        ]
                    })
                });
                alert(`Sukses menambahkan stok masuk!`);
                // Reset Form Fields
                document.getElementById('inbound-qty').value = '';
                document.getElementById('inbound-keterangan').value = '';
                generateInboundTxNumber();
            }

            renderInboundPanel();
        } catch (err) {
            alert('Gagal memproses stok masuk: ' + err.message);
        }
    });

    document.getElementById('btn-batal-inbound')?.addEventListener('click', resetInboundForm);

    // 4. Kelola Driver Form
    const formDriver = document.getElementById('form-driver');
    if (formDriver) {
        formDriver.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (currentSession.role !== 'Admin Gudang') return alert('Hak Akses Ditolak!');

            const nama = document.getElementById('driver-nama').value.trim();
            const username = document.getElementById('driver-username').value.trim().toLowerCase();
            const password = document.getElementById('driver-password').value.trim();

            if (!nama || !username || !password) return alert('Semua kolom wajib diisi!');

            // Automatically append " (Driver)" to driver name to make it look premium
            // and clearly distinguish them from admins in lists, unless it already has it.
            let finalName = nama;
            if (!nama.toLowerCase().includes('(driver)')) {
                finalName = `${nama} (Driver)`;
            }

            try {
                await apiFetch('/drivers', {
                    method: 'POST',
                    body: JSON.stringify({
                        username,
                        password,
                        nama_lengkap: finalName
                    })
                });

                alert(`Driver ${nama} berhasil ditambahkan!`);

                // Reset Form
                document.getElementById('driver-nama').value = '';
                document.getElementById('driver-username').value = '';
                document.getElementById('driver-password').value = '';

                // Reload driver list
                renderDriverPanel();
            } catch (err) {
                alert('Gagal menambahkan driver: ' + err.message);
            }
        });
    }

    // 5. Kelola Outlet Form
    const formOutlet = document.getElementById('form-outlet');
    if (formOutlet) {
        formOutlet.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (currentSession.role !== 'Admin Gudang') return alert('Hak Akses Ditolak!');

            const nama = document.getElementById('outlet-nama').value.trim();
            const alamat = document.getElementById('outlet-alamat').value.trim();
            const telepon = document.getElementById('outlet-telepon').value.trim();

            if (!nama) return alert('Nama outlet wajib diisi!');

            try {
                await apiFetch('/outlets', {
                    method: 'POST',
                    body: JSON.stringify({
                        nama_outlet: nama,
                        alamat,
                        telepon
                    })
                });

                alert(`Outlet ${nama} berhasil ditambahkan!`);

                // Reset Form
                document.getElementById('outlet-nama').value = '';
                document.getElementById('outlet-alamat').value = '';
                document.getElementById('outlet-telepon').value = '';

                // Reload outlet list & dropdown
                renderOutletPanel();
                populateOutletDropdown('distribusi-outlet');
            } catch (err) {
                alert('Gagal menambahkan outlet: ' + err.message);
            }
        });
    }

    // 3. Outbound / Distribusi - CEK STOK
    document.getElementById('btn-cek-stok').addEventListener('click', async () => {
        const selectBarang = document.getElementById('select-validasi-barang');
        const qtyInput = document.getElementById('input-validasi-qty');
        const feedback = document.getElementById('feedback-validasi-stok');
        const btnTambah = document.getElementById('btn-tambah-checklist');

        const barangId = parseInt(selectBarang.value);
        const qty = parseInt(qtyInput.value);

        if (!barangId) {
            showFeedback('Pilih barang terlebih dahulu!', 'warning');
            btnTambah.disabled = true;
            return;
        }

        if (isNaN(qty) || qty <= 0) {
            showFeedback('Masukkan jumlah Qty valid (> 0)!', 'warning');
            btnTambah.disabled = true;
            return;
        }

        try {
            const barangDb = await apiFetch('/barang');
            const item = barangDb.find(b => b.id === barangId);
            if (!item) return;

            // Calculate if already in temporary list
            const alreadyInList = tempOutboundChecklist.find(c => c.barang_id === barangId);
            const addedQty = alreadyInList ? alreadyInList.jumlah : 0;
            const totalNeeded = qty + addedQty;

            if (item.stok_sekarang >= totalNeeded) {
                showFeedback(`Stok Tersedia! Stok saat ini: ${item.stok_sekarang} unit. (Batas threshold aman)`, 'success');
                btnTambah.disabled = false;
            } else {
                const kurang = totalNeeded - item.stok_sekarang;
                showFeedback(`Stok Tidak Cukup! Stok gudang: ${item.stok_sekarang} unit. Kurang ${kurang} unit!`, 'warning');
                btnTambah.disabled = true;
            }
        } catch (err) {
            showFeedback('Gagal cek stok: ' + err.message, 'warning');
        }
    });

    // Add to checklist
    document.getElementById('btn-tambah-checklist').addEventListener('click', async () => {
        const selectBarang = document.getElementById('select-validasi-barang');
        const qtyInput = document.getElementById('input-validasi-qty');

        const barangId = parseInt(selectBarang.value);
        const qty = parseInt(qtyInput.value);

        try {
            const barangDb = await apiFetch('/barang');
            const item = barangDb.find(b => b.id === barangId);
            if (!item) return;

            // Check if item is already in temporary checklist
            const existingIdx = tempOutboundChecklist.findIndex(c => c.barang_id === barangId);
            if (existingIdx !== -1) {
                tempOutboundChecklist[existingIdx].jumlah += qty;
            } else {
                tempOutboundChecklist.push({
                    barang_id: barangId,
                    kode_barang: item.kode_barang,
                    nama_barang: item.nama_barang,
                    kategori: item.kategori,
                    jumlah: qty
                });
            }

            // Reset validasi block inputs
            selectBarang.value = '';
            qtyInput.value = '';
            document.getElementById('feedback-validasi-stok').classList.add('hidden');
            document.getElementById('btn-tambah-checklist').disabled = true;

            renderOutboundChecklistTable();
        } catch (err) {
            alert('Gagal menambahkan ke daftar: ' + err.message);
        }
    });

    // Outbound / Distribusi Final Process
    document.getElementById('btn-proses-distribusi').addEventListener('click', async () => {
        if (currentSession.role !== 'Admin Gudang') return alert('Hak Akses Ditolak!');

        const noTx = document.getElementById('distribusi-no-transaksi').value;
        const noSj = document.getElementById('distribusi-surat-jalan').value;
        const driver = document.getElementById('distribusi-driver').value.trim();
        const outlet = document.getElementById('distribusi-outlet').value;
        const keterangan = document.getElementById('distribusi-keterangan').value.trim();

        if (!driver || !outlet || tempOutboundChecklist.length === 0) {
            alert('Lengkapi seluruh form driver, outlet, dan pastikan sudah menambahkan barang ke daftar!');
            return;
        }

        try {
            const res = await apiFetch('/distribusi', {
                method: 'POST',
                body: JSON.stringify({
                    nomor_transaksi: noTx,
                    surat_jalan: noSj,
                    outlet_tujuan: outlet,
                    nama_driver: driver,
                    keterangan: keterangan || `Distribusi ke ${outlet} via ${driver}`,
                    detail_items: tempOutboundChecklist.map(c => ({
                        barang_id: c.barang_id,
                        jumlah: c.jumlah
                    }))
                })
            });

            alert(`Surat Jalan ${noSj} berhasil diproses!`);

            // Open Printable Surat Jalan modal immediately using the created distribution
            const newDistribution = {
                id: res.data.id,
                surat_jalan: noSj,
                outlet_tujuan: outlet,
                nama_driver: driver,
                tanggal_kirim: new Date().toISOString()
            };
            openPrintSuratJalan(newDistribution, tempOutboundChecklist, keterangan, currentSession.nama);

            // Clear forms
            document.getElementById('distribusi-driver').value = '';
            document.getElementById('distribusi-outlet').value = '';
            document.getElementById('distribusi-keterangan').value = '';
            tempOutboundChecklist = [];

            generateOutboundTxAndSjNumbers();
            renderOutboundPanel();
        } catch (err) {
            alert('Gagal memproses distribusi: ' + err.message);
        }
    });

    // Laporan Panel Filters
    const filterLaporanTipe = document.getElementById('filter-laporan-tipe');
    const filterTanggalMulai = document.getElementById('filter-tanggal-mulai');
    const filterTanggalSelesai = document.getElementById('filter-tanggal-selesai');

    if (filterLaporanTipe) filterLaporanTipe.addEventListener('change', renderLaporanPanel);
    if (filterTanggalMulai) filterTanggalMulai.addEventListener('change', renderLaporanPanel);
    if (filterTanggalSelesai) filterTanggalSelesai.addEventListener('change', renderLaporanPanel);

    const btnResetLaporan = document.getElementById('btn-reset-laporan');
    if (btnResetLaporan) {
        btnResetLaporan.addEventListener('click', () => {
            if (filterLaporanTipe) filterLaporanTipe.value = '1';
            if (filterTanggalMulai) filterTanggalMulai.value = '';
            if (filterTanggalSelesai) filterTanggalSelesai.value = '';
            renderLaporanPanel();
        });
    }

    // Cetak Laporan button click
    const btnCetakLaporan = document.getElementById('btn-cetak-laporan');
    if (btnCetakLaporan) {
        btnCetakLaporan.addEventListener('click', () => {
            window.print();
        });
    }

    // Cetak Daftar Barang button click
    const btnCetakBarang = document.getElementById('btn-cetak-barang');
    if (btnCetakBarang) {
        btnCetakBarang.addEventListener('click', async () => {
            await openPrintBarang();
        });
    }
});

// ==========================================
// 3. NAVIGATION & VIEW ROUTING
// ==========================================

function switchPanel(panelId) {
    // Active navigation state
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-target') === panelId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Switch visible content panels
    document.querySelectorAll('.content-panel').forEach(panel => {
        if (panel.id === panelId) {
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    });

    // Update Topbar Title
    let title = 'Dashboard';
    switch (panelId) {
        case 'panel-dashboard': title = 'Dashboard'; break;
        case 'panel-barang': title = 'Manajemen Barang'; break;
        case 'panel-stok-masuk': title = 'Registrasi Transaksi Masuk'; break;
        case 'panel-distribusi': title = 'Logistik & Kelola Distribusi Surat Jalan'; break;
        case 'panel-driver': title = 'Manajemen Logistik & Kelola Driver'; break;
        case 'panel-outlet': title = 'Manajemen Logistik & Kelola Outlet'; break;
        case 'panel-laporan': title = 'Laporan Laba Rugi & Mutasi Gudang'; break;
    }
    document.getElementById('current-panel-title').innerText = title;

    // Render corresponding panel contents
    renderActivePanel(panelId);
}

function renderActivePanel(panelId = null) {
    if (!panelId) {
        // Find currently visible panel
        const activePanel = document.querySelector('.content-panel:not(.hidden)');
        panelId = activePanel ? activePanel.id : 'panel-dashboard';
    }

    switch (panelId) {
        case 'panel-dashboard':
            renderDashboardPanel();
            break;
        case 'panel-barang':
            renderBarangPanel();
            break;
        case 'panel-stok-masuk':
            renderInboundPanel();
            break;
        case 'panel-distribusi':
            renderOutboundPanel();
            break;
        case 'panel-laporan':
            renderLaporanPanel();
            break;
        case 'panel-driver':
            renderDriverPanel();
            break;
        case 'panel-outlet':
            renderOutletPanel();
            break;
    }
}

// Login Overlay Controls
function showLoginOverlay() {
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');

    // Clear inputs
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
}

function fillDemo(username, password) {
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
}

function loginUser(session) {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');

    // Set text elements
    document.getElementById('sidebar-user-name').innerText = session.nama;
    document.getElementById('sidebar-user-role').innerText = session.role;
    document.getElementById('badge-user-name').innerText = session.nama;
    document.getElementById('badge-user-role').innerText = session.role === 'Admin Gudang' ? 'Admin' : session.role === 'Pengantar Barang' ? 'Driver' : 'Pimpinan';
    document.getElementById('user-avatar-initial').innerText = session.nama.charAt(0);

    // Set switcher state
    const switcher = document.getElementById('quick-role-select');
    if (switcher) switcher.value = session.role;

    applyRoleConstraints();

    // Redirect to Kelola Distribusi directly for drivers, others go to Dashboard
    if (session.role === 'Pengantar Barang') {
        switchPanel('panel-distribusi');
    } else {
        switchPanel('panel-dashboard');
    }
}

// Strict Role Enforcement
function applyRoleConstraints() {
    const isPimpinan = currentSession.role === 'Pimpinan';
    const isDriver = currentSession.role === 'Pengantar Barang';
    const banner = document.getElementById('role-warning-banner');
    const warningTextEl = banner ? banner.querySelector('.warning-text') : null;

    if (isPimpinan) {
        if (banner) banner.classList.add('hidden');
        // Disable forms inputs
        disableAllFormFields('form-barang');
        disableAllFormFields('form-inbound');
        disableAllFormFields('form-distribusi');
        disableAllFormFields('form-outlet');
        // Hide checklist add controls
        document.getElementById('select-validasi-barang').disabled = true;
        document.getElementById('input-validasi-qty').disabled = true;
        document.getElementById('btn-cek-stok').disabled = true;
        document.getElementById('btn-tambah-checklist').disabled = true;
        document.getElementById('btn-proses-distribusi').disabled = true;

        // Show outbound input row
        const distInputRow = document.getElementById('distribusi-input-row');
        if (distInputRow) distInputRow.classList.remove('hidden');
    } else if (isDriver) {
        if (banner) banner.classList.add('hidden');
        // Disable forms inputs
        disableAllFormFields('form-outlet');
        // Hide outbound creation form grid entirely for cleaner interface
        const distInputRow = document.getElementById('distribusi-input-row');
        if (distInputRow) distInputRow.classList.add('hidden');
    } else {
        if (banner) banner.classList.add('hidden');
        // Enable forms
        enableAllFormFields('form-barang');
        enableAllFormFields('form-inbound');
        enableAllFormFields('form-distribusi');
        enableAllFormFields('form-outlet');

        // Custom resets
        document.getElementById('barang-sku').disabled = false;
        document.getElementById('inbound-no-transaksi').disabled = true; // must stay readOnly
        document.getElementById('distribusi-no-transaksi').disabled = true; // must stay readOnly
        document.getElementById('distribusi-surat-jalan').disabled = true; // must stay readOnly

        document.getElementById('select-validasi-barang').disabled = false;
        document.getElementById('input-validasi-qty').disabled = false;
        document.getElementById('btn-cek-stok').disabled = false;

        // Show outbound input row
        const distInputRow = document.getElementById('distribusi-input-row');
        if (distInputRow) distInputRow.classList.remove('hidden');
    }

    // Toggle sidebar navigation items based on role
    document.querySelectorAll('.nav-item').forEach(item => {
        const target = item.getAttribute('data-target');
        if (isDriver) {
            if (target === 'panel-barang' || target === 'panel-stok-masuk' || target === 'panel-laporan' || target === 'panel-dashboard' || target === 'panel-driver' || target === 'panel-outlet') {
                item.classList.add('hidden');
            } else {
                item.classList.remove('hidden');
            }
        } else if (isPimpinan) {
            if (target === 'panel-barang' || target === 'panel-stok-masuk' || target === 'panel-distribusi' || target === 'panel-driver' || target === 'panel-outlet') {
                item.classList.add('hidden');
            } else {
                item.classList.remove('hidden');
            }
        } else {
            item.classList.remove('hidden');
        }
    });

    // Toggle Gudang specific columns or UI actions
    const gudangOnlyElements = document.querySelectorAll('.role-gudang-only');
    gudangOnlyElements.forEach(el => {
        if (isPimpinan || isDriver) {
            el.classList.add('hidden');
        } else {
            el.classList.remove('hidden');
        }
    });
}

function disableAllFormFields(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    const elements = form.elements;
    for (let i = 0; i < elements.length; i++) {
        elements[i].disabled = true;
    }
}

function enableAllFormFields(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    const elements = form.elements;
    for (let i = 0; i < elements.length; i++) {
        elements[i].disabled = false;
    }
}

// ------------------------------------------
// PANEL 1: DASHBOARD
// ------------------------------------------
async function renderDashboardPanel() {
    try {
        const [statsData, barangDb, distDb] = await Promise.all([
            apiFetch('/dashboard'),
            apiFetch('/barang'),
            apiFetch('/distribusi')
        ]);

        // Apply values to UI
        document.getElementById('kpi-sku').innerText = statsData.stats.total_sku;
        const uniqueKategori = [...new Set(barangDb.map(b => b.kategori))].length;
        document.getElementById('kpi-sku-detail').innerText = `Total Kategori: ${uniqueKategori}`;
        document.getElementById('kpi-kritis').innerText = statsData.stats.stok_kritis;
        document.getElementById('kpi-perjalanan').innerText = statsData.stats.dalam_perjalanan;
        document.getElementById('kpi-sukses').innerText = statsData.stats.pengiriman_sukses;

        // Render Activity Log
        const logsList = document.getElementById('activity-log-list');
        logsList.innerHTML = '';

        let activityLogs = [];
        distDb.forEach(d => {
            activityLogs.push({
                deskripsi: `Barang Keluar dibuat: ${d.surat_jalan} ke ${d.outlet_tujuan} via ${d.nama_driver}`,
                tipe: 'sj',
                timestamp: d.tanggal_kirim
            });
            if (d.tanggal_diterima) {
                activityLogs.push({
                    deskripsi: `Status pengiriman ${d.surat_jalan} diperbarui ke Selesai`,
                    tipe: 'sj',
                    timestamp: d.tanggal_diterima
                });
            }
        });

        // Add barang creations to logs
        barangDb.forEach(b => {
            activityLogs.push({
                deskripsi: `Item baru ${b.kode_barang} (${b.nama_barang}) terdaftar`,
                tipe: 'item',
                timestamp: b.created_at
            });
        });

        // Sort descending (newest first)
        activityLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const sortedLogs = activityLogs.slice(0, 5);

        if (sortedLogs.length === 0) {
            logsList.innerHTML = '<li class="empty-state">Belum ada aktivitas tercatat.</li>';
        } else {
            sortedLogs.forEach(log => {
                const timeStr = formatTimeAgo(log.timestamp);
                const li = document.createElement('li');
                li.className = `activity-item ${log.tipe}`;
                li.innerHTML = `
                    <span class="activity-desc">${log.deskripsi}</span>
                    <span class="activity-time">${timeStr}</span>
                `;
                logsList.appendChild(li);
            });
        }

        // Render Dynamic Charts
        renderCharts(barangDb, distDb);
    } catch (err) {
        console.error('Failed to render dashboard:', err);
    }
}

// ------------------------------------------
// CHARTS DEFINITION (CHART.JS)
// ------------------------------------------
async function renderCharts(barangDb, distDb) {
    // Destruct previous charts instances to prevent canvas collision
    if (chartKategoriInstance) chartKategoriInstance.destroy();
    if (chartMutasiInstance) chartMutasiInstance.destroy();

    // Chart A: Category Stocks Composition
    const categoriesMap = {};
    barangDb.forEach(b => {
        categoriesMap[b.kategori] = (categoriesMap[b.kategori] || 0) + b.stok_sekarang;
    });

    const ctxA = document.getElementById('chart-kategori').getContext('2d');
    chartKategoriInstance = new Chart(ctxA, {
        type: 'doughnut',
        data: {
            labels: Object.keys(categoriesMap),
            datasets: [{
                data: Object.values(categoriesMap),
                backgroundColor: [
                    'rgba(59, 130, 246, 0.7)',
                    'rgba(16, 185, 129, 0.7)',
                    'rgba(245, 158, 11, 0.7)',
                    'rgba(239, 68, 68, 0.7)',
                    'rgba(139, 92, 246, 0.7)'
                ],
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#cbd5e1', font: { family: 'Inter', size: 11 } }
                }
            }
        }
    });

    // Chart B: Mutasi Trend
    let inQty = 0;
    let outQty = 0;

    try {
        const transactions = await apiFetch('/transaksi');
        transactions.forEach(t => {
            t.detail_transaksi.forEach(det => {
                if (t.jenis_transaksi === 'IN') inQty += det.jumlah;
                else if (t.jenis_transaksi === 'OUT') outQty += det.jumlah;
            });
        });
    } catch (err) {
        console.error('Failed to load transaction statistics:', err);
    }

    const ctxB = document.getElementById('chart-mutasi').getContext('2d');
    chartMutasiInstance = new Chart(ctxB, {
        type: 'bar',
        data: {
            labels: ['Barang Masuk (IN)', 'Barang Keluar (OUT)'],
            datasets: [{
                label: 'Volume Produk (Unit)',
                data: [inQty, outQty],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.65)',
                    'rgba(239, 68, 68, 0.65)'
                ],
                borderColor: [
                    '#10b981',
                    '#ef4444'
                ],
                borderWidth: 1.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}

// ------------------------------------------
// PANEL 2: MANAJEMEN BARANG
// ------------------------------------------
async function renderBarangPanel() {
    try {
        const barangDb = await apiFetch('/barang');
        const tbody = document.querySelector('#table-barang tbody');
        tbody.innerHTML = '';

        barangDb.forEach((item, index) => {
            const tr = document.createElement('tr');

            // Critical status checks
            const isCritical = item.stok_sekarang <= item.stok_minimum;
            const statusBadge = isCritical
                ? '<span class="badge badge-danger">Kritis</span>'
                : '<span class="badge badge-success">Aman</span>';

            const priceFormatted = formatRupiah(parseFloat(item.harga));

            tr.innerHTML = `
                <td>${index + 1}</td>
                <td class="text-bold">${item.kode_barang}</td>
                <td>${item.nama_barang}</td>
                <td>${item.kategori}</td>
                <td>${priceFormatted}</td>
                <td class="text-semibold ${isCritical ? 'text-red' : 'text-green'}">${item.stok_sekarang}</td>
                <td>${item.stok_minimum}</td>
                <td>${statusBadge}</td>
                <td class="role-gudang-only align-center">
                    <div class="action-buttons">
                        <button class="btn-icon edit" onclick="editBarang(${item.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                                <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                            </svg>
                        </button>
                        <button class="btn-icon delete" onclick="deleteBarang(${item.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75V4H3a.75.75 0 000 1.5h10.25a.75.75 0 000-1.5H14v-.25A2.75 2.75 0 0011.25 1h-2.5zM5 6v9.25A2.75 2.75 0 007.75 18h4.5A2.75 2.75 0 0015 15.25V6H5zm3.75 3a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75zm3 0a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        applyRoleConstraints();
    } catch (err) {
        console.error('Failed to load items list:', err);
    }
}

async function editBarang(id) {
    if (currentSession.role !== 'Admin Gudang') return;
    try {
        const barangDb = await apiFetch('/barang');
        const matched = barangDb.find(b => b.id === id);
        if (!matched) return;

        // Populates fields
        document.getElementById('barang-id').value = matched.id;
        document.getElementById('barang-sku').value = matched.kode_barang;
        document.getElementById('barang-sku').disabled = true; // disable SKU alteration
        document.getElementById('barang-nama').value = matched.nama_barang;
        document.getElementById('barang-kategori').value = matched.kategori;
        document.getElementById('barang-harga').value = matched.harga;
        document.getElementById('barang-stok-min').value = matched.stok_minimum;

        // Hide stok awal (existing item)
        document.getElementById('container-stok-awal').classList.add('hidden');
        document.getElementById('btn-batal-barang').classList.remove('hidden');
    } catch (err) {
        alert('Gagal mengambil data barang: ' + err.message);
    }
}

async function deleteBarang(id) {
    if (currentSession.role !== 'Admin Gudang') return;

    if (confirm('Apakah Anda yakin ingin menghapus barang ini secara permanen?')) {
        try {
            await apiFetch(`/barang/${id}`, {
                method: 'DELETE'
            });
            alert('Barang berhasil dihapus.');
            renderBarangPanel();
        } catch (err) {
            alert('Gagal menghapus barang: ' + err.message);
        }
    }
}

function resetBarangForm() {
    document.getElementById('barang-id').value = '';
    document.getElementById('barang-sku').value = '';
    document.getElementById('barang-sku').disabled = false;
    document.getElementById('barang-nama').value = '';
    document.getElementById('barang-kategori').value = '';
    document.getElementById('barang-harga').value = '';
    document.getElementById('barang-stok-min').value = '10';
    document.getElementById('barang-stok-awal').value = '0';

    document.getElementById('container-stok-awal').classList.remove('hidden');
    document.getElementById('btn-batal-barang').classList.add('hidden');
}

// ------------------------------------------
// PANEL 3: INPUT STOK MASUK (INBOUND)
// ------------------------------------------
function renderInboundPanel() {
    generateInboundTxNumber();
    populateBarangDropdown('inbound-barang');
    renderRecentInboundTable();
}

function generateInboundTxNumber() {
    const timestamp = getFormattedTimestamp();
    document.getElementById('inbound-no-transaksi').value = `TX-IN-${timestamp}`;
}

async function populateBarangDropdown(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">-- Pilih Barang --</option>';

    try {
        const barangDb = await apiFetch('/barang');
        barangDb.forEach(b => {
            const option = document.createElement('option');
            option.value = b.id;
            option.innerText = `${b.kode_barang} - ${b.nama_barang} (Stok: ${b.stok_sekarang})`;
            select.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to populate barang dropdown:', err);
    }
}

async function populateDriverDropdown(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">-- Pilih Driver --</option>';

    try {
        const drivers = await apiFetch('/drivers');
        drivers.forEach(d => {
            const option = document.createElement('option');
            // Normalize the name (e.g. converting "Andi Wijaya (Driver)" to "Andi Wijaya" for database submission)
            const normalizedName = d.nama_lengkap.replace(/\s*\(driver\)/i, '').trim();
            option.value = normalizedName;
            option.innerText = d.nama_lengkap;
            select.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to populate driver dropdown:', err);
    }
}

// ------------------------------------------
// PANEL 6: MANAJEMEN DRIVER (ADMIN ONLY)
// ------------------------------------------
async function renderDriverPanel() {
    try {
        const drivers = await apiFetch('/drivers');
        const tbody = document.querySelector('#table-driver tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (drivers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="align-center text-muted">Belum ada pengantar barang (driver) terdaftar.</td></tr>';
        } else {
            drivers.forEach((driver, index) => {
                const tr = document.createElement('tr');
                const tglDaftar = driver.created_at ? formatDate(driver.created_at) : '-';
                const plainPass = driver.password_plain || 'admin123';

                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td class="text-bold">${driver.username}</td>
                    <td class="text-semibold">${driver.nama_lengkap}</td>
                    <td>
                        <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
                            <span class="masked-pass" id="pass-text-${driver.id}" style="font-family: monospace; letter-spacing: 0.1em;">••••••••</span>
                            <button type="button" class="btn btn-secondary btn-icon" style="padding: 0; width: 24px; height: 24px; border-radius: var(--border-radius-sm);" onclick="togglePassVisibility(${driver.id}, '${plainPass}')" title="Tampilkan/Sembunyikan Password">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 14px; height: 14px;">
                                    <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                                    <path fill-rule="evenodd" d="M.664 9.576a13.91 13.91 0 0118.673 0 .75.75 0 010 1.148 13.91 13.91 0 01-18.673 0 .75.75 0 010-1.148zM3.485 10a12.41 12.41 0 0013.03 0 12.41 12.41 0 00-13.03 0z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    </td>
                    <td><span class="badge badge-info">Driver</span></td>
                    <td>${tglDaftar}</td>
                    <td class="align-center">
                        <button class="btn btn-secondary btn-icon delete" style="padding:0; width:30px; height:30px;" onclick="deleteDriver(${driver.id}, '${driver.nama_lengkap}')">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 16px; height: 16px;">
                                <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75V4H3a.75.75 0 000 1.5h10.25a.75.75 0 000-1.5H14v-.25A2.75 2.75 0 0011.25 1h-2.5zM5 6v9.25A2.75 2.75 0 007.75 18h4.5A2.75 2.75 0 0015 15.25V6H5zm3.75 3a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75zm3 0a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error('Failed to render drivers:', err);
    }
}

// Global Toggle Password function
window.togglePassVisibility = function (id, plainPassword) {
    const el = document.getElementById(`pass-text-${id}`);
    if (!el) return;
    if (el.innerText === '••••••••') {
        el.innerText = plainPassword;
    } else {
        el.innerText = '••••••••';
    }
};

async function deleteDriver(id, name) {
    if (currentSession.role !== 'Admin Gudang') return;

    if (confirm(`Apakah Anda yakin ingin menghapus driver "${name}" secara permanen? Akun login driver ini akan dihapus.`)) {
        try {
            await apiFetch(`/drivers/${id}`, {
                method: 'DELETE'
            });
            alert(`Driver ${name} berhasil dihapus.`);
            renderDriverPanel();
        } catch (err) {
            alert('Gagal menghapus driver: ' + err.message);
        }
    }
}

// ------------------------------------------
// PANEL: KELOLA OUTLET (ADMIN ONLY)
// ------------------------------------------
async function populateOutletDropdown(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">-- Pilih Outlet --</option>';

    try {
        const outlets = await apiFetch('/outlets');
        outlets.forEach(o => {
            const option = document.createElement('option');
            option.value = o.nama_outlet;
            option.innerText = o.nama_outlet;
            select.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to populate outlet dropdown:', err);
    }
}

async function renderOutletPanel() {
    try {
        const outlets = await apiFetch('/outlets');
        const tbody = document.querySelector('#table-outlet tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (outlets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="align-center text-muted">Belum ada outlet terdaftar.</td></tr>';
        } else {
            outlets.forEach((outlet, index) => {
                const tr = document.createElement('tr');
                const tglDaftar = outlet.created_at ? formatDate(outlet.created_at) : '-';

                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td class="text-bold">${outlet.nama_outlet}</td>
                    <td class="text-semibold">${outlet.alamat || '-'}</td>
                    <td>${outlet.telepon || '-'}</td>
                    <td>${tglDaftar}</td>
                    <td class="align-center">
                        <button class="btn btn-secondary btn-icon delete" style="padding:0; width:30px; height:30px;" onclick="deleteOutlet(${outlet.id}, '${outlet.nama_outlet}')">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 16px; height: 16px;">
                                <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75V4H3a.75.75 0 000 1.5h10.25a.75.75 0 000-1.5H14v-.25A2.75 2.75 0 0011.25 1h-2.5zM5 6v9.25A2.75 2.75 0 007.75 18h4.5A2.75 2.75 0 0015 15.25V6H5zm3.75 3a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75zm3 0a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error('Failed to render outlets:', err);
    }
}

window.deleteOutlet = async function (id, name) {
    if (currentSession.role !== 'Admin Gudang') return;

    if (confirm(`Apakah Anda yakin ingin menghapus outlet "${name}" secara permanen?`)) {
        try {
            await apiFetch(`/outlets/${id}`, {
                method: 'DELETE'
            });
            alert(`Outlet ${name} berhasil dihapus.`);
            renderOutletPanel();
            populateOutletDropdown('distribusi-outlet');
        } catch (err) {
            alert('Gagal menghapus outlet: ' + err.message);
        }
    }
};

window.editInbound = async function (id) {
    if (currentSession.role !== 'Admin Gudang') return;
    try {
        const transactions = await apiFetch('/transaksi');
        const matched = transactions.find(t => t.id === id);
        if (!matched) return;

        const detail = matched.detail_transaksi[0];
        if (!detail) return;

        // Populates fields
        document.getElementById('inbound-id').value = matched.id;
        document.getElementById('inbound-no-transaksi').value = matched.nomor_transaksi;
        document.getElementById('inbound-barang').value = detail.barang_id;
        document.getElementById('inbound-qty').value = detail.jumlah;
        document.getElementById('inbound-keterangan').value = matched.keterangan || '';

        // Switch header & button
        document.querySelector('#panel-stok-masuk .card-header h3').innerText = 'Edit Inbound (Barang Masuk)';
        document.getElementById('btn-proses-inbound').innerText = 'Simpan Perubahan';
        document.getElementById('btn-batal-inbound').classList.remove('hidden');

        // Scroll to form
        document.getElementById('form-inbound').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        alert('Gagal mengambil data transaksi: ' + err.message);
    }
};

window.deleteInbound = async function (id) {
    if (currentSession.role !== 'Admin Gudang') return;

    if (confirm('Apakah Anda yakin ingin menghapus transaksi masuk ini? Stok barang akan dikurangi kembali.')) {
        try {
            await apiFetch(`/transaksi/${id}`, {
                method: 'DELETE'
            });
            alert('Transaksi berhasil dihapus.');
            renderInboundPanel();
        } catch (err) {
            alert('Gagal menghapus transaksi: ' + err.message);
        }
    }
};

window.resetInboundForm = function () {
    document.getElementById('inbound-id').value = '';
    document.getElementById('inbound-qty').value = '';
    document.getElementById('inbound-keterangan').value = '';
    document.getElementById('inbound-barang').value = '';

    document.querySelector('#panel-stok-masuk .card-header h3').innerText = 'Form Inbound (Barang Masuk)';
    document.getElementById('btn-proses-inbound').innerText = 'Tambah Stok';
    document.getElementById('btn-batal-inbound').classList.add('hidden');

    generateInboundTxNumber();
};

async function renderRecentInboundTable() {
    try {
        const transactions = await apiFetch('/transaksi');
        const tbody = document.querySelector('#table-inbound tbody');
        tbody.innerHTML = '';

        // Filter only IN transactions
        const inTransactions = transactions.filter(t => t.jenis_transaksi === 'IN');

        let rows = [];
        inTransactions.forEach(tx => {
            tx.detail_transaksi.forEach(det => {
                rows.push({
                    id: tx.id,
                    no_transaksi: tx.nomor_transaksi,
                    tanggal: tx.tanggal_transaksi,
                    kode_sku: det.barang ? det.barang.kode_barang : '?',
                    nama_barang: det.barang ? det.barang.nama_barang : 'Barang Dihapus',
                    kategori: det.barang ? det.barang.kategori : '-',
                    jumlah: det.jumlah,
                    keterangan: tx.keterangan
                });
            });
        });

        // Sort newest first
        rows.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="align-center text-muted">Belum ada transaksi barang masuk.</td></tr>';
        } else {
            rows.slice(0, 10).forEach((row, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td class="text-bold">${row.no_transaksi}</td>
                    <td>${formatDate(row.tanggal)}</td>
                    <td>${row.kode_sku}</td>
                    <td>${row.nama_barang}</td>
                    <td>${row.kategori}</td>
                    <td class="text-green text-semibold">+${row.jumlah}</td>
                    <td>${row.keterangan}</td>
                    <td class="role-gudang-only align-center">
                        <div class="action-buttons">
                            <button class="btn-icon edit" onclick="editInbound(${row.id})">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                                    <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                                </svg>
                            </button>
                            <button class="btn-icon delete" onclick="deleteInbound(${row.id})">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75V4H3a.75.75 0 000 1.5h10.25a.75.75 0 000-1.5H14v-.25A2.75 2.75 0 0011.25 1h-2.5zM5 6v9.25A2.75 2.75 0 007.75 18h4.5A2.75 2.75 0 0015 15.25V6H5zm3.75 3a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75zm3 0a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
        applyRoleConstraints();
    } catch (err) {
        console.error('Failed to load recent inbounds:', err);
    }
}

// ------------------------------------------
// PANEL 4: KELOLA DISTRIBUSI (OUTBOUND)
// ------------------------------------------
function renderOutboundPanel() {
    generateOutboundTxAndSjNumbers();
    populateBarangDropdown('select-validasi-barang');
    populateDriverDropdown('distribusi-driver');
    populateOutletDropdown('distribusi-outlet');
    renderOutboundChecklistTable();
    renderDistribusiTable();
}

function generateOutboundTxAndSjNumbers() {
    const timestamp = getFormattedTimestamp();
    document.getElementById('distribusi-no-transaksi').value = `TX-OUT-${timestamp}`;
    document.getElementById('distribusi-surat-jalan').value = `SJ-${timestamp}`;
}

function showFeedback(message, type) {
    const fb = document.getElementById('feedback-validasi-stok');
    fb.innerText = message;
    fb.className = `feedback-badge ${type}`;
    fb.classList.remove('hidden');
}

function renderOutboundChecklistTable() {
    const tbody = document.getElementById('body-checklist');
    tbody.innerHTML = '';

    if (tempOutboundChecklist.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="align-center text-muted">Belum ada barang dipilih. Gunakan validasi stok di atas.</td></tr>';
        document.getElementById('btn-proses-distribusi').disabled = true;
    } else {
        tempOutboundChecklist.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="text-bold">${item.kode_barang}</td>
                <td>${item.nama_barang}</td>
                <td class="text-semibold">${item.jumlah}</td>
                <td>
                    <button type="button" class="btn btn-secondary btn-icon delete" style="padding:0; width:26px; height:26px;" onclick="removeChecklistItem(${item.barang_id})">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75V4H3a.75.75 0 000 1.5h10.25a.75.75 0 000-1.5H14v-.25A2.75 2.75 0 0011.25 1h-2.5zM5 6v9.25A2.75 2.75 0 007.75 18h4.5A2.75 2.75 0 0015 15.25V6H5z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (currentSession.role === 'Admin Gudang') {
            document.getElementById('btn-proses-distribusi').disabled = false;
        }
    }
}

function removeChecklistItem(barangId) {
    tempOutboundChecklist = tempOutboundChecklist.filter(c => c.barang_id !== barangId);
    renderOutboundChecklistTable();
}

async function renderDistribusiTable() {
    try {
        const distDb = await apiFetch('/distribusi');
        const tbody = document.querySelector('#table-distribusi tbody');
        tbody.innerHTML = '';

        if (distDb.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="align-center text-muted">Belum ada pengiriman terdaftar.</td></tr>';
        } else {
            distDb.forEach((dist, idx) => {
                const tr = document.createElement('tr');

                // Build items list representation
                let itemsHtml = '<ul style="padding-left:1rem; font-size:0.8rem; text-align:left;">';
                dist.transaksi?.detail_transaksi?.forEach(det => {
                    itemsHtml += `<li>${det.barang ? det.barang.nama_barang : '?'}: <strong>${det.jumlah}</strong></li>`;
                });
                itemsHtml += '</ul>';

                // Status design
                let statusBadge = '';
                let actionBtn = '';
                const isDriver = currentSession.role === 'Pengantar Barang';
                const isAdmin = currentSession.role === 'Admin Gudang';
                const canUpdateStatus = isAdmin || isDriver;

                if (dist.status_pengiriman === 'Persiapan') {
                    statusBadge = '<span class="badge badge-info">Persiapan</span>';
                    actionBtn = canUpdateStatus
                        ? `<button class="btn btn-success btn-block" style="padding:0.4rem; font-size:0.75rem;" onclick="updateDistStatus(${dist.id}, 'Pengiriman')">🚚 Kirim</button>`
                        : '';
                } else if (dist.status_pengiriman === 'Pengiriman') {
                    statusBadge = '<span class="badge badge-warning">Pengiriman</span>';
                    actionBtn = canUpdateStatus
                        ? `<button class="btn btn-primary btn-block" style="padding:0.4rem; font-size:0.75rem;" onclick="updateDistStatus(${dist.id}, 'Selesai')">✅ Tiba di Outlet</button>`
                        : '';
                } else {
                    statusBadge = '<span class="badge badge-success">Selesai</span>';
                    actionBtn = '<span class="text-green text-semibold" style="font-size:0.82rem;">✔️ Diterima</span>';
                }

                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td class="text-bold">${dist.surat_jalan}</td>
                    <td>${dist.outlet_tujuan}</td>
                    <td class="text-semibold">${dist.nama_driver}</td>
                    <td>${formatDate(dist.tanggal_kirim)}</td>
                    <td>${statusBadge}</td>
                    <td>${itemsHtml}</td>
                    <td>
                        <div style="display:flex; flex-direction:column; gap:0.4rem;">
                            ${actionBtn}
                            <button class="btn btn-secondary btn-block" style="padding:0.4rem; font-size:0.75rem;" onclick="reprintSuratJalan(${dist.id})">🖨️ Cetak SJ</button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        applyRoleConstraints();
    } catch (err) {
        console.error('Failed to render distributions:', err);
    }
}

async function updateDistStatus(distId, newStatus) {
    if (currentSession.role !== 'Admin Gudang' && currentSession.role !== 'Pengantar Barang') return;

    try {
        await apiFetch(`/distribusi/${distId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status_pengiriman: newStatus })
        });
        alert(`Status pengiriman berhasil diperbarui ke ${newStatus}!`);
        renderDistribusiTable();
    } catch (err) {
        alert('Gagal memperbarui status pengiriman: ' + err.message);
    }
}

// ------------------------------------------
// PANEL 5: LAPORAN (REPORT LEDGER)
// ------------------------------------------
async function renderLaporanPanel() {
    const tipeReport = document.getElementById('filter-laporan-tipe')?.value || '1';
    const tanggalMulai = document.getElementById('filter-tanggal-mulai')?.value || '';
    const tanggalSelesai = document.getElementById('filter-tanggal-selesai')?.value || '';

    // Build URL Query String
    let queryParams = [];
    if (tanggalMulai) queryParams.push(`tanggal_mulai=${tanggalMulai}`);
    if (tanggalSelesai) queryParams.push(`tanggal_selesai=${tanggalSelesai}`);
    const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

    // Endpoint mapping
    let endpoint = '/reports/inbound';
    let reportTitle = 'Laporan Transaksi Barang Masuk';

    switch (tipeReport) {
        case '1':
            endpoint = '/reports/inbound';
            reportTitle = 'Laporan Transaksi Barang Masuk';
            break;
        case '2':
            endpoint = '/reports/outbound';
            reportTitle = 'Laporan Transaksi Barang Keluar';
            break;
        case '3':
            endpoint = '/reports/mutasi-stok';
            reportTitle = 'Laporan Mutasi Stok';
            break;
        case '4':
            endpoint = '/reports/rekap-distribusi';
            reportTitle = 'Laporan Rekapitulasi Status Distribusi';
            break;
        case '5':
            endpoint = '/reports/lead-time';
            reportTitle = 'Laporan Performa Waktu Pengiriman';
            break;
        case '6':
            endpoint = '/reports/fast-moving';
            reportTitle = 'Laporan Analisis Barang Distribusi Cepat';
            break;
        case '7':
            endpoint = '/reports/outlet-serapan';
            reportTitle = 'Laporan Serapan Distribusi Berdasarkan Outlet';
            break;
        case '8':
            endpoint = '/reports/admin-productivity';
            reportTitle = 'Laporan Produktivitas Log Transaksi Admin Gudang';
            break;
    }

    // Update Titles in UI
    const titleEl = document.getElementById('table-laporan-title');
    if (titleEl) titleEl.innerText = reportTitle;

    const printTitleEl = document.getElementById('print-laporan-title');
    if (printTitleEl) printTitleEl.innerText = reportTitle.toUpperCase();

    // Update Printed Period in UI
    let periodText = 'Periode: Semua Waktu';
    if (tanggalMulai && tanggalSelesai) {
        periodText = `Periode: ${formatDateOnly(tanggalMulai)} s/d ${formatDateOnly(tanggalSelesai)}`;
    } else if (tanggalMulai) {
        periodText = `Periode: Sejak ${formatDateOnly(tanggalMulai)}`;
    } else if (tanggalSelesai) {
        periodText = `Periode: Sampai ${formatDateOnly(tanggalSelesai)}`;
    }
    const printPeriodEl = document.getElementById('print-laporan-period');
    if (printPeriodEl) printPeriodEl.innerText = periodText;

    try {
        const data = await apiFetch(`${endpoint}${queryString}`);
        const thead = document.querySelector('#table-laporan thead');
        const tbody = document.querySelector('#table-laporan tbody');

        if (!thead || !tbody) return;

        thead.innerHTML = '';
        tbody.innerHTML = '';

        // Dynamically build thead and tbody based on the selected report type
        if (tipeReport === '1' || tipeReport === '2') {
            // Inbound & Outbound report
            thead.innerHTML = `
                <tr>
                    <th style="width: 50px;">No</th>
                    <th>Tanggal Transaksi</th>
                    <th>No. Transaksi</th>
                    <th>Kode SKU</th>
                    <th>Nama Barang</th>
                    <th class="align-right">${tipeReport === '1' ? 'Qty Masuk' : 'Qty Keluar'}</th>
                    <th>Nama Admin</th>
                </tr>
            `;

            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="align-center text-muted">Tidak ditemukan data transaksi mutasi yang cocok dengan filter.</td></tr>`;
            } else {
                data.forEach((row, idx) => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${idx + 1}</td>
                        <td>${formatDate(row.tanggal)}</td>
                        <td class="text-bold">${row.nomor_transaksi}</td>
                        <td class="text-bold">${row.kode_barang}</td>
                        <td>${row.nama_barang}</td>
                        <td class="align-right text-semibold ${tipeReport === '1' ? 'text-green' : 'text-red'}">
                            ${tipeReport === '1' ? '+' : '-'}${row.jumlah}
                        </td>
                        <td>${row.admin_name}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } else if (tipeReport === '3') {
            // Mutasi Stok (Kartu Stok)
            thead.innerHTML = `
                <tr>
                    <th style="width: 50px;">No</th>
                    <th>Tanggal</th>
                    <th>Jenis Mutasi</th>
                    <th>No. Referensi</th>
                    <th>Kode SKU</th>
                    <th>Nama Barang</th>
                    <th class="align-right">Qty Masuk</th>
                    <th class="align-right">Qty Keluar</th>
                </tr>
            `;

            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" class="align-center text-muted">Tidak ditemukan data mutasi stok yang cocok dengan filter.</td></tr>`;
            } else {
                data.forEach((row, idx) => {
                    const tr = document.createElement('tr');
                    const badge = row.jenis_mutasi === 'IN'
                        ? '<span class="badge badge-success">Masuk (IN)</span>'
                        : '<span class="badge badge-danger">Keluar (OUT)</span>';

                    tr.innerHTML = `
                        <td>${idx + 1}</td>
                        <td>${formatDate(row.tanggal)}</td>
                        <td>${badge}</td>
                        <td class="text-bold">${row.nomor_referensi}</td>
                        <td class="text-bold">${row.kode_barang}</td>
                        <td>${row.nama_barang}</td>
                        <td class="align-right text-semibold text-green">${row.qty_masuk > 0 ? '+' + row.qty_masuk : '-'}</td>
                        <td class="align-right text-semibold text-red">${row.qty_keluar > 0 ? '-' + row.qty_keluar : '-'}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } else if (tipeReport === '4') {
            // Rekapitulasi Status Distribusi
            thead.innerHTML = `
                <tr>
                    <th style="width: 50px;">No</th>
                    <th>Tgl Kirim</th>
                    <th>No. Surat Jalan</th>
                    <th>Outlet Tujuan</th>
                    <th style="max-width: 250px;">Detail Muatan</th>
                    <th>Driver</th>
                    <th>Status Pengiriman</th>
                </tr>
            `;

            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="align-center text-muted">Tidak ditemukan data rekapitulasi distribusi yang cocok dengan filter.</td></tr>`;
            } else {
                data.forEach((row, idx) => {
                    const tr = document.createElement('tr');
                    let statusBadge = '';
                    if (row.status_pengiriman === 'Persiapan') {
                        statusBadge = '<span class="badge badge-info">Persiapan</span>';
                    } else if (row.status_pengiriman === 'Pengiriman') {
                        statusBadge = '<span class="badge badge-warning">Pengiriman</span>';
                    } else {
                        statusBadge = '<span class="badge badge-success">Selesai</span>';
                    }

                    tr.innerHTML = `
                        <td>${idx + 1}</td>
                        <td>${formatDate(row.tanggal_kirim)}</td>
                        <td class="text-bold">${row.surat_jalan}</td>
                        <td class="text-semibold">${row.outlet_tujuan}</td>
                        <td style="max-width: 250px; font-size: 0.82rem; text-align: left;">${row.detail_muatan}</td>
                        <td class="text-semibold">${row.driver}</td>
                        <td>${statusBadge}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } else if (tipeReport === '5') {
            // Performa Waktu Pengiriman (Lead Time)
            thead.innerHTML = `
                <tr>
                    <th style="width: 50px;">No</th>
                    <th>No. Surat Jalan</th>
                    <th>Outlet Tujuan</th>
                    <th>Driver</th>
                    <th>Waktu Berangkat</th>
                    <th>Waktu Tiba</th>
                    <th class="align-center">Total Durasi Waktu</th>
                </tr>
            `;

            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="align-center text-muted">Tidak ditemukan data pengiriman log yang cocok dengan filter.</td></tr>`;
            } else {
                data.forEach((row, idx) => {
                    const tr = document.createElement('tr');
                    const departures = row.waktu_berangkat ? formatDate(row.waktu_berangkat) : '-';
                    const arrival = row.waktu_tiba ? formatDate(row.waktu_tiba) : '<span class="text-muted italic">Dalam perjalanan</span>';

                    let durasiBadge = row.durasi;
                    if (row.durasi !== 'Dalam Pengiriman' && row.durasi !== 'Persiapan') {
                        durasiBadge = `<span class="text-semibold text-blue">${row.durasi}</span>`;
                    } else if (row.durasi === 'Dalam Pengiriman') {
                        durasiBadge = '<span class="badge badge-warning">Dalam Pengiriman</span>';
                    } else {
                        durasiBadge = '<span class="badge badge-info">Persiapan</span>';
                    }

                    tr.innerHTML = `
                        <td>${idx + 1}</td>
                        <td class="text-bold">${row.surat_jalan}</td>
                        <td>${row.outlet_tujuan}</td>
                        <td class="text-semibold">${row.driver}</td>
                        <td>${departures}</td>
                        <td>${arrival}</td>
                        <td class="align-center">${durasiBadge}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } else if (tipeReport === '6') {
            // Fast-Moving Analysis
            thead.innerHTML = `
                <tr>
                    <th style="width: 100px; text-align: center;">Peringkat</th>
                    <th>Kode SKU</th>
                    <th>Nama Barang</th>
                    <th class="align-center">Frekuensi Keluar</th>
                    <th class="align-right">Total Qty Terdistribusi</th>
                </tr>
            `;

            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="align-center text-muted">Tidak ditemukan data mutasi outbound untuk analisis periode ini.</td></tr>`;
            } else {
                data.forEach((row) => {
                    const tr = document.createElement('tr');

                    let rankBadge = '';
                    if (row.peringkat === 1) {
                        rankBadge = '<span class="badge badge-warning" style="background:#fbbf24; color:#78350f; font-weight:800;">🏆 1st</span>';
                    } else if (row.peringkat === 2) {
                        rankBadge = '<span class="badge" style="background:#cbd5e1; color:#1e293b; font-weight:800; border:1px solid #94a3b8;">🥈 2nd</span>';
                    } else if (row.peringkat === 3) {
                        rankBadge = '<span class="badge" style="background:#f59e0b; color:#78350f; font-weight:800; opacity:0.8;">🥉 3rd</span>';
                    } else {
                        rankBadge = `<span class="text-muted text-semibold">${row.peringkat}</span>`;
                    }

                    tr.innerHTML = `
                        <td class="align-center">${rankBadge}</td>
                        <td class="text-bold">${row.kode_barang}</td>
                        <td class="text-semibold">${row.nama_barang}</td>
                        <td class="align-center text-semibold">${row.frekuensi} kali</td>
                        <td class="align-right text-bold text-blue">${row.total_qty} unit</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } else if (tipeReport === '7') {
            // Serapan Distribusi Berdasarkan Outlet
            thead.innerHTML = `
                <tr>
                    <th style="width: 50px;">No</th>
                    <th>Nama Outlet Tujuan</th>
                    <th class="align-center">Jumlah Kunjungan (Surat Jalan)</th>
                    <th class="align-right">Total Item Barang Diserap</th>
                </tr>
            `;

            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="align-center text-muted">Tidak ditemukan data logistik serapan outlet cocok filter.</td></tr>`;
            } else {
                data.forEach((row, idx) => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${idx + 1}</td>
                        <td class="text-bold text-blue">${row.nama_outlet}</td>
                        <td class="align-center text-semibold">${row.kunjungan} kali</td>
                        <td class="align-right text-bold text-green">${row.total_item} unit</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } else if (tipeReport === '8') {
            // Produktivitas Log Transaksi Admin Gudang
            thead.innerHTML = `
                <tr>
                    <th style="width: 50px;">No</th>
                    <th>Nama Admin</th>
                    <th>Jabatan</th>
                    <th class="align-center">Total Nota Masuk (IN)</th>
                    <th class="align-center">Total Nota Keluar (OUT)</th>
                    <th class="align-right">Total Diproses</th>
                </tr>
            `;

            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="align-center text-muted">Tidak ditemukan data pencatatan aktivitas admin.</td></tr>`;
            } else {
                data.forEach((row, idx) => {
                    const tr = document.createElement('tr');
                    const totalDiproses = row.total_in + row.total_out;
                    tr.innerHTML = `
                        <td>${idx + 1}</td>
                        <td class="text-bold">${row.nama_admin}</td>
                        <td class="text-muted">${row.jabatan}</td>
                        <td class="align-center text-semibold text-green">${row.total_in} nota</td>
                        <td class="align-center text-semibold text-red">${row.total_out} nota</td>
                        <td class="align-right text-bold text-blue">${totalDiproses} nota</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }
    } catch (err) {
        console.error('Failed to load dynamic reports ledger:', err);
        const tbody = document.querySelector('#table-laporan tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" class="align-center text-red">Gagal memuat data laporan: ${err.message}</td></tr>`;
        }
    }
}

// ------------------------------------------
// 5. INVOICE PRINT MODAL LOGIC (SURAT JALAN)
// ------------------------------------------
function openPrintSuratJalan(dist, itemsList, keterangan, adminName) {
    document.getElementById('print-sj-nomor').innerText = dist.surat_jalan;
    document.getElementById('print-sj-tanggal').innerText = formatDateOnly(dist.tanggal_kirim);
    document.getElementById('print-sj-admin').innerText = adminName;
    document.getElementById('print-sj-tujuan').innerText = dist.outlet_tujuan;
    document.getElementById('print-sj-driver').innerText = dist.nama_driver;
    document.getElementById('print-sj-keterangan').innerText = keterangan || '-';

    document.getElementById('print-sj-sign-admin').innerText = adminName;
    document.getElementById('print-sj-sign-driver').innerText = dist.nama_driver;

    const tbody = document.getElementById('print-sj-items-body');
    tbody.innerHTML = '';

    itemsList.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td class="text-bold">${item.kode_barang}</td>
            <td>${item.nama_barang}</td>
            <td>${item.kategori}</td>
            <td class="align-right text-bold">${item.jumlah}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('print-surat-jalan-modal').classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closePrintModal() {
    document.getElementById('print-surat-jalan-modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

async function openPrintBarang() {
    try {
        const barangDb = await apiFetch('/barang');
        
        // Populate printed date
        const now = new Date();
        const dateStr = `${now.getDate().toString().padStart(2, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getFullYear()}`;
        document.getElementById('print-barang-tanggal').innerText = dateStr;
        
        // Populate admin
        const adminName = currentSession ? currentSession.nama : 'Budi Santoso (Admin)';
        document.getElementById('print-barang-admin').innerText = adminName;
        document.getElementById('print-barang-sign-admin').innerText = adminName;
        
        // Populate items table
        const tbody = document.getElementById('print-barang-items-body');
        tbody.innerHTML = '';
        
        barangDb.forEach((item, index) => {
            const tr = document.createElement('tr');
            const isCritical = item.stok_sekarang <= item.stok_minimum;
            const statusBadge = isCritical
                ? '<span class="badge badge-danger">Kritis</span>'
                : '<span class="badge badge-success">Aman</span>';
            const priceFormatted = formatRupiah(parseFloat(item.harga));
            
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td class="text-bold">${item.kode_barang}</td>
                <td>${item.nama_barang}</td>
                <td>${item.kategori}</td>
                <td>${priceFormatted}</td>
                <td class="align-right text-semibold ${isCritical ? 'text-red' : 'text-green'}">${item.stok_sekarang}</td>
                <td class="align-right">${item.stok_minimum}</td>
                <td>${statusBadge}</td>
            `;
            tbody.appendChild(tr);
        });
        
        document.getElementById('print-barang-modal').classList.remove('hidden');
        document.body.classList.add('modal-open');
    } catch (err) {
        alert('Gagal memproses cetak daftar barang: ' + err.message);
    }
}

function closePrintBarangModal() {
    document.getElementById('print-barang-modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

async function reprintSuratJalan(distId) {
    try {
        const distDb = await apiFetch('/distribusi');
        const dist = distDb.find(d => d.id === distId);
        if (!dist) return;

        const tx = dist.transaksi;
        const itemsList = dist.transaksi?.detail_transaksi?.map(d => ({
            barang_id: d.barang_id,
            kode_barang: d.barang ? d.barang.kode_barang : '?',
            nama_barang: d.barang ? d.barang.nama_barang : '?',
            kategori: d.barang ? d.barang.kategori : '?',
            jumlah: d.jumlah
        })) || [];

        const adminName = currentSession ? currentSession.nama : 'Budi Santoso (Admin)';

        openPrintSuratJalan(dist, itemsList, tx ? tx.keterangan : '', adminName);
    } catch (err) {
        alert('Gagal memuat ulang Surat Jalan: ' + err.message);
    }
}

// ==========================================
// 6. GENERAL UTILITY FUNCTIONS
// ==========================================

// Format Date string
function formatDate(isoStr) {
    const d = new Date(isoStr);
    return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDateOnly(isoStr) {
    if (!isoStr) return '-';
    // Handle simple YYYY-MM-DD strings directly to prevent timezone shift issues
    if (typeof isoStr === 'string' && isoStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const parts = isoStr.split('-');
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '-';
    return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
}

// Timestamp for numbers (YYYYMMDD-HHMMSS)
function getFormattedTimestamp() {
    const d = new Date();
    const Y = d.getFullYear();
    const M = (d.getMonth() + 1).toString().padStart(2, '0');
    const D = d.getDate().toString().padStart(2, '0');
    const H = d.getHours().toString().padStart(2, '0');
    const min = d.getMinutes().toString().padStart(2, '0');
    const S = d.getSeconds().toString().padStart(2, '0');
    return `${Y}${M}${D}-${H}${min}${S}`;
}

// Rupiah currency formatter
function formatRupiah(num) {
    return 'Rp ' + num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
}

// Time ago calculation
function formatTimeAgo(isoStr) {
    const diffMs = new Date() - new Date(isoStr);
    const secs = Math.floor(diffMs / 1000);
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} hari yang lalu`;
    if (hours > 0) return `${hours} jam yang lalu`;
    if (mins > 0) return `${mins} menit yang lalu`;
    return 'Baru saja';
}

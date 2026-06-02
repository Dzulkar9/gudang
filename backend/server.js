/**
 * ====================================================================
 * Backend Server API - PT Graha Prima Mentari Warehouse Administration
 * Express.js & Prisma ORM Implementation
 * ====================================================================
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_gudang_gpm';

app.use(cors());
app.use(express.json());

// ==========================================
// MIDDLEWARES
// ==========================================

// Authenticate JWT Token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Akses ditolak, token tidak ditemukan' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Token tidak valid atau kadaluwarsa' });
        req.user = user;
        next();
    });
};

// Check if user is Admin Gudang
const isAdminGudang = (req, res, next) => {
    if (req.user.role !== 'Admin Gudang') {
        return res.status(403).json({ message: 'Akses ditolak: Hanya Admin Gudang yang diperbolehkan' });
    }
    next();
};

// Check if user is Pimpinan or Admin Gudang (Both can read data)
const isAnyRole = (req, res, next) => {
    if (req.user.role !== 'Admin Gudang' && req.user.role !== 'Pimpinan' && req.user.role !== 'Pengantar Barang') {
        return res.status(403).json({ message: 'Akses ditolak: Peran tidak dikenali' });
    }
    next();
};

// Check if user is Admin Gudang or Pimpinan (Authorized for reports)
const isAuthorizedForReports = (req, res, next) => {
    if (req.user.role !== 'Admin Gudang' && req.user.role !== 'Pimpinan') {
        return res.status(403).json({ message: 'Akses ditolak: Hanya Admin Gudang dan Pimpinan yang diperbolehkan melihat laporan' });
    }
    next();
};

// Check if user is Admin Gudang or Pengantar Barang (Authorized to update delivery status)
const canUpdateDistStatus = (req, res, next) => {
    if (req.user.role !== 'Admin Gudang' && req.user.role !== 'Pengantar Barang') {
        return res.status(403).json({ message: 'Akses ditolak: Hanya Admin Gudang dan Pengantar Barang yang diperbolehkan memperbarui status pengiriman' });
    }
    next();
};

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

// Register User
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, role, nama_lengkap } = req.body;

        if (!username || !password || !role || !nama_lengkap) {
            return res.status(400).json({ message: 'Semua kolom harus diisi' });
        }

        const userExists = await prisma.user.findUnique({ where: { username } });
        if (userExists) {
            return res.status(400).json({ message: 'Username sudah digunakan' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                username,
                password_hash: hashedPassword,
                password_plain: password,
                role: role === 'Pimpinan' ? 'Pimpinan' : role === 'Pengantar Barang' ? 'Pengantar_Barang' : 'Admin_Gudang',
                nama_lengkap
            }
        });

        res.status(201).json({
            message: 'Registrasi berhasil',
            user: { id: newUser.id, username: newUser.username, role: newUser.role }
        });
    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
    }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(400).json({ message: 'Username atau password salah' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(400).json({ message: 'Username atau password salah' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role === 'Admin_Gudang' ? 'Admin Gudang' : user.role === 'Pengantar_Barang' ? 'Pengantar Barang' : 'Pimpinan', nama: user.nama_lengkap },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            message: 'Login berhasil',
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role === 'Admin_Gudang' ? 'Admin Gudang' : user.role === 'Pengantar_Barang' ? 'Pengantar Barang' : 'Pimpinan',
                nama_lengkap: user.nama_lengkap
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
    }
});

// ==========================================
// MASTER BARANG ROUTES (Inventory)
// ==========================================

// Get All Items (Accessible by both roles)
app.get('/api/barang', authenticateToken, isAnyRole, async (req, res) => {
    try {
        const items = await prisma.barang.findMany({
            orderBy: { kode_barang: 'asc' }
        });
        res.json(items);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil data barang', error: error.message });
    }
});

// Add New Item (Only Admin Gudang)
app.post('/api/barang', authenticateToken, isAdminGudang, async (req, res) => {
    try {
        const { kode_barang, nama_barang, kategori, stok_minimum, stok_sekarang, harga } = req.body;

        if (!kode_barang || !nama_barang || !kategori) {
            return res.status(400).json({ message: 'Kode, Nama, dan Kategori wajib diisi' });
        }

        const existingItem = await prisma.barang.findUnique({ where: { kode_barang } });
        if (existingItem) {
            return res.status(400).json({ message: 'Kode barang (SKU) sudah terdaftar' });
        }

        const newItem = await prisma.barang.create({
            data: {
                kode_barang,
                nama_barang,
                kategori,
                stok_minimum: parseInt(stok_minimum) || 10,
                stok_sekarang: parseInt(stok_sekarang) || 0,
                harga: parseFloat(harga) || 0.00
            }
        });

        res.status(201).json({ message: 'Barang berhasil ditambahkan', data: newItem });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menambahkan barang', error: error.message });
    }
});

// Update Item (Only Admin Gudang)
app.put('/api/barang/:id', authenticateToken, isAdminGudang, async (req, res) => {
    try {
        const { id } = req.params;
        const { nama_barang, kategori, stok_minimum, harga } = req.body;

        const updatedItem = await prisma.barang.update({
            where: { id: parseInt(id) },
            data: {
                nama_barang,
                kategori,
                stok_minimum: parseInt(stok_minimum),
                harga: parseFloat(harga)
            }
        });

        res.json({ message: 'Barang berhasil diperbarui', data: updatedItem });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memperbarui barang', error: error.message });
    }
});

// Delete Item (Only Admin Gudang)
app.delete('/api/barang/:id', authenticateToken, isAdminGudang, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.barang.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Barang berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus barang. Pastikan tidak ada transaksi yang merujuk barang ini.', error: error.message });
    }
});

// ==========================================
// TRANSAKSI GUDANG ROUTES (Inbound / Outbound)
// ==========================================

// Add Inbound/Outbound Transaction (Only Admin Gudang)
app.post('/api/transaksi', authenticateToken, isAdminGudang, async (req, res) => {
    const { jenis_transaksi, nomor_transaksi, keterangan, detail_items } = req.body;

    if (!jenis_transaksi || !nomor_transaksi || !detail_items || detail_items.length === 0) {
        return res.status(400).json({ message: 'Data transaksi tidak lengkap' });
    }

    try {
        // Run database transaction to ensure stock consistency
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Transaction
            const txGudang = await tx.transaksiGudang.create({
                data: {
                    nomor_transaksi,
                    jenis_transaksi,
                    admin_id: req.user.id,
                    keterangan
                }
            });

            // 2. Process items details and update stocks
            for (const item of detail_items) {
                const dbBarang = await tx.barang.findUnique({
                    where: { id: parseInt(item.barang_id) }
                });

                if (!dbBarang) {
                    throw new Error(`Barang dengan ID ${item.barang_id} tidak ditemukan`);
                }

                let newStock = dbBarang.stok_sekarang;
                if (jenis_transaksi === 'IN') {
                    newStock += item.jumlah;
                } else if (jenis_transaksi === 'OUT') {
                    if (dbBarang.stok_sekarang < item.jumlah) {
                        throw new Error(`Stok barang ${dbBarang.nama_barang} tidak mencukupi. Tersedia: ${dbBarang.stok_sekarang}, diminta: ${item.jumlah}`);
                    }
                    newStock -= item.jumlah;
                }

                // Update Stock
                await tx.barang.update({
                    where: { id: dbBarang.id },
                    data: { stok_sekarang: newStock }
                });

                // Create Transaction Detail
                await tx.detailTransaksiGudang.create({
                    data: {
                        transaksi_id: txGudang.id,
                        barang_id: dbBarang.id,
                        jumlah: item.jumlah
                    }
                });
            }

            return txGudang;
        });

        res.status(201).json({ message: `Transaksi ${jenis_transaksi} berhasil diproses`, data: result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Get All Transactions (Accessible by both roles)
app.get('/api/transaksi', authenticateToken, isAnyRole, async (req, res) => {
    try {
        const transactions = await prisma.transaksiGudang.findMany({
            include: {
                detail_transaksi: {
                    include: { barang: true }
                }
            },
            orderBy: { tanggal_transaksi: 'desc' }
        });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil data transaksi', error: error.message });
    }
});

// ==========================================
// DISTRIBUSI ROUTES
// ==========================================

// Create Distribution & Outbound (Only Admin Gudang)
app.post('/api/distribusi', authenticateToken, isAdminGudang, async (req, res) => {
    const { nomor_transaksi, surat_jalan, outlet_tujuan, nama_driver, keterangan, detail_items } = req.body;

    if (!surat_jalan || !outlet_tujuan || !nama_driver || !detail_items || detail_items.length === 0) {
        return res.status(400).json({ message: 'Data surat jalan / distribusi tidak lengkap' });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Outbound Transaction First
            const txGudang = await tx.transaksiGudang.create({
                data: {
                    nomor_transaksi,
                    jenis_transaksi: 'OUT',
                    admin_id: req.user.id,
                    keterangan: keterangan || `Distribusi ke ${outlet_tujuan} via ${nama_driver}`
                }
            });

            // 2. Validate & Update stock + Create details
            for (const item of detail_items) {
                const dbBarang = await tx.barang.findUnique({
                    where: { id: parseInt(item.barang_id) }
                });

                if (!dbBarang) throw new Error(`Barang ID ${item.barang_id} tidak ditemukan`);

                if (dbBarang.stok_sekarang < item.jumlah) {
                    throw new Error(`Stok ${dbBarang.nama_barang} tidak cukup. Stok: ${dbBarang.stok_sekarang}, Diminta: ${item.jumlah}`);
                }

                await tx.barang.update({
                    where: { id: dbBarang.id },
                    data: { stok_sekarang: dbBarang.stok_sekarang - item.jumlah }
                });

                await tx.detailTransaksiGudang.create({
                    data: {
                        transaksi_id: txGudang.id,
                        barang_id: dbBarang.id,
                        jumlah: item.jumlah
                    }
                });
            }

            // 3. Create Distribution Record
            const distribusiRecord = await tx.distribusi.create({
                data: {
                    surat_jalan,
                    transaksi_id: txGudang.id,
                    outlet_tujuan,
                    nama_driver,
                    status_pengiriman: 'Persiapan'
                }
            });

            return distribusiRecord;
        });

        res.status(201).json({ message: 'Distribusi & Surat Jalan berhasil dibuat', data: result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Update Distribution Status (Admin Gudang & Pengantar Barang)
app.put('/api/distribusi/:id/status', authenticateToken, canUpdateDistStatus, async (req, res) => {
    try {
        const { id } = req.params;
        const { status_pengiriman } = req.body;

        if (!['Persiapan', 'Pengiriman', 'Selesai'].includes(status_pengiriman)) {
            return res.status(400).json({ message: 'Status pengiriman tidak valid' });
        }

        const dataUpdate = { status_pengiriman };
        if (status_pengiriman === 'Selesai') {
            dataUpdate.tanggal_diterima = new Date();
        }

        const updatedDistribusi = await prisma.distribusi.update({
            where: { id: parseInt(id) },
            data: dataUpdate
        });

        res.json({ message: 'Status distribusi berhasil diperbarui', data: updatedDistribusi });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memperbarui status', error: error.message });
    }
});

// Get All Distributions & Tracking (Accessible by all roles with custom driver filtering)
app.get('/api/distribusi', authenticateToken, isAnyRole, async (req, res) => {
    try {
        let whereClause = {};

        // If the logged in user is a driver (Pengantar Barang), only return their shipments!
        if (req.user.role === 'Pengantar Barang' && req.user.nama) {
            const driverBaseName = req.user.nama.replace(/\s*\(driver\)/i, '').trim();
            whereClause = {
                nama_driver: {
                    contains: driverBaseName,
                    mode: 'insensitive'
                }
            };
        }

        const listDistribusi = await prisma.distribusi.findMany({
            where: whereClause,
            include: {
                transaksi: {
                    include: {
                        detail_transaksi: {
                            include: { barang: true }
                        }
                    }
                }
            },
            orderBy: { id: 'desc' }
        });
        res.json(listDistribusi);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil data distribusi', error: error.message });
    }
});

// Get All Drivers (Users with role Pengantar_Barang)
app.get('/api/drivers', authenticateToken, isAnyRole, async (req, res) => {
    try {
        const drivers = await prisma.user.findMany({
            where: {
                role: 'Pengantar_Barang'
            },
            select: {
                id: true,
                username: true,
                nama_lengkap: true,
                password_plain: true,
                created_at: true
            },
            orderBy: { nama_lengkap: 'asc' }
        });
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil data driver', error: error.message });
    }
});

// Add New Driver (Only Admin Gudang)
app.post('/api/drivers', authenticateToken, isAdminGudang, async (req, res) => {
    try {
        const { username, password, nama_lengkap } = req.body;

        if (!username || !password || !nama_lengkap) {
            return res.status(400).json({ message: 'Username, password, dan nama lengkap wajib diisi' });
        }

        const userExists = await prisma.user.findUnique({ where: { username } });
        if (userExists) {
            return res.status(400).json({ message: 'Username sudah digunakan' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newDriver = await prisma.user.create({
            data: {
                username,
                password_hash: hashedPassword,
                password_plain: password,
                role: 'Pengantar_Barang',
                nama_lengkap
            }
        });

        res.status(201).json({
            message: 'Driver berhasil didaftarkan',
            data: { id: newDriver.id, username: newDriver.username, nama_lengkap: newDriver.nama_lengkap }
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menambahkan driver', error: error.message });
    }
});

// Delete Driver (Only Admin Gudang)
app.delete('/api/drivers/:id', authenticateToken, isAdminGudang, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.user.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Driver berhasil dihapus secara permanen' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus driver', error: error.message });
    }
});

// ==========================================
// OUTLET MANAGEMENT ROUTES
// ==========================================

// Get All Outlets (Accessible by all roles)
app.get('/api/outlets', authenticateToken, isAnyRole, async (req, res) => {
    try {
        const outlets = await prisma.outlet.findMany({
            orderBy: { nama_outlet: 'asc' }
        });
        res.json(outlets);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil data outlet', error: error.message });
    }
});

// Add New Outlet (Only Admin Gudang)
app.post('/api/outlets', authenticateToken, isAdminGudang, async (req, res) => {
    try {
        const { nama_outlet, alamat, telepon } = req.body;

        if (!nama_outlet) {
            return res.status(400).json({ message: 'Nama outlet wajib diisi' });
        }

        const existingOutlet = await prisma.outlet.findUnique({ where: { nama_outlet } });
        if (existingOutlet) {
            return res.status(400).json({ message: 'Nama outlet sudah terdaftar' });
        }

        const newOutlet = await prisma.outlet.create({
            data: {
                nama_outlet,
                alamat,
                telepon
            }
        });

        res.status(201).json({ message: 'Outlet berhasil ditambahkan', data: newOutlet });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menambahkan outlet', error: error.message });
    }
});

// Delete Outlet (Only Admin Gudang)
app.delete('/api/outlets/:id', authenticateToken, isAdminGudang, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.outlet.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Outlet berhasil dihapus secara permanen' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus outlet. Pastikan tidak ada distribusi aktif yang merujuk outlet ini.', error: error.message });
    }
});

// ==========================================
// REPORTS & DASHBOARD
// ==========================================

// Get Dashboard Data (Accessible by both roles)
app.get('/api/dashboard', authenticateToken, isAnyRole, async (req, res) => {
    try {
        const totalItems = await prisma.barang.count();
        const criticalItems = await prisma.barang.count({
            where: {
                stok_sekarang: { lte: prisma.barang.fields.stok_minimum }
            }
        });

        const inTransit = await prisma.distribusi.count({
            where: { status_pengiriman: 'Pengiriman' }
        });

        const delivered = await prisma.distribusi.count({
            where: { status_pengiriman: 'Selesai' }
        });

        const recentDistributions = await prisma.distribusi.findMany({
            take: 5,
            orderBy: { id: 'desc' }
        });

        res.json({
            stats: {
                total_sku: totalItems,
                stok_kritis: criticalItems,
                dalam_perjalanan: inTransit,
                pengiriman_sukses: delivered
            },
            recent_logs: recentDistributions
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil data dashboard', error: error.message });
    }
});

// ==========================================
// 8 TRANSAKSIONAL REPORTS API
// ==========================================

// 1. Laporan Transaksi Barang Masuk (Inbound)
app.get('/api/reports/inbound', authenticateToken, isAuthorizedForReports, async (req, res) => {
    try {
        const { tanggal_mulai, tanggal_selesai } = req.query;
        let dateFilter = {};
        if (tanggal_mulai && tanggal_selesai) {
            dateFilter = {
                tanggal_transaksi: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`),
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        } else if (tanggal_mulai) {
            dateFilter = {
                tanggal_transaksi: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`)
                }
            };
        } else if (tanggal_selesai) {
            dateFilter = {
                tanggal_transaksi: {
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        }

        const details = await prisma.detailTransaksiGudang.findMany({
            where: {
                transaksi: {
                    jenis_transaksi: 'IN',
                    ...dateFilter
                }
            },
            include: {
                transaksi: {
                    include: {
                        admin: true
                    }
                },
                barang: true
            },
            orderBy: {
                transaksi: {
                    tanggal_transaksi: 'desc'
                }
            }
        });

        const formatted = details.map(d => ({
            tanggal: d.transaksi.tanggal_transaksi,
            nomor_transaksi: d.transaksi.nomor_transaksi,
            kode_barang: d.barang.kode_barang,
            nama_barang: d.barang.nama_barang,
            jumlah: d.jumlah,
            admin_name: d.transaksi.admin.nama_lengkap
        }));

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat laporan inbound', error: error.message });
    }
});

// 2. Laporan Transaksi Barang Keluar (Outbound)
app.get('/api/reports/outbound', authenticateToken, isAuthorizedForReports, async (req, res) => {
    try {
        const { tanggal_mulai, tanggal_selesai } = req.query;
        let dateFilter = {};
        if (tanggal_mulai && tanggal_selesai) {
            dateFilter = {
                tanggal_transaksi: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`),
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        } else if (tanggal_mulai) {
            dateFilter = {
                tanggal_transaksi: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`)
                }
            };
        } else if (tanggal_selesai) {
            dateFilter = {
                tanggal_transaksi: {
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        }

        const details = await prisma.detailTransaksiGudang.findMany({
            where: {
                transaksi: {
                    jenis_transaksi: 'OUT',
                    ...dateFilter
                }
            },
            include: {
                transaksi: {
                    include: {
                        admin: true
                    }
                },
                barang: true
            },
            orderBy: {
                transaksi: {
                    tanggal_transaksi: 'desc'
                }
            }
        });

        const formatted = details.map(d => ({
            tanggal: d.transaksi.tanggal_transaksi,
            nomor_transaksi: d.transaksi.nomor_transaksi,
            kode_barang: d.barang.kode_barang,
            nama_barang: d.barang.nama_barang,
            jumlah: d.jumlah,
            admin_name: d.transaksi.admin.nama_lengkap
        }));

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat laporan outbound', error: error.message });
    }
});

// 3. Laporan Mutasi Stok (Kartu Stok Transaksional)
app.get('/api/reports/mutasi-stok', authenticateToken, isAuthorizedForReports, async (req, res) => {
    try {
        const { tanggal_mulai, tanggal_selesai } = req.query;
        let dateFilter = {};
        if (tanggal_mulai && tanggal_selesai) {
            dateFilter = {
                tanggal_transaksi: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`),
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        } else if (tanggal_mulai) {
            dateFilter = {
                tanggal_transaksi: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`)
                }
            };
        } else if (tanggal_selesai) {
            dateFilter = {
                tanggal_transaksi: {
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        }

        const details = await prisma.detailTransaksiGudang.findMany({
            where: {
                transaksi: dateFilter
            },
            include: {
                transaksi: true,
                barang: true
            },
            orderBy: {
                transaksi: {
                    tanggal_transaksi: 'desc'
                }
            }
        });

        const formatted = details.map(d => ({
            tanggal: d.transaksi.tanggal_transaksi,
            jenis_mutasi: d.transaksi.jenis_transaksi,
            nomor_referensi: d.transaksi.nomor_transaksi,
            kode_barang: d.barang.kode_barang,
            nama_barang: d.barang.nama_barang,
            qty_masuk: d.transaksi.jenis_transaksi === 'IN' ? d.jumlah : 0,
            qty_keluar: d.transaksi.jenis_transaksi === 'OUT' ? d.jumlah : 0
        }));

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat laporan mutasi stok', error: error.message });
    }
});

// 4. Laporan Rekapitulasi Status Distribusi
app.get('/api/reports/rekap-distribusi', authenticateToken, isAuthorizedForReports, async (req, res) => {
    try {
        const { tanggal_mulai, tanggal_selesai } = req.query;
        let dateFilter = {};
        if (tanggal_mulai && tanggal_selesai) {
            dateFilter = {
                tanggal_kirim: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`),
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        } else if (tanggal_mulai) {
            dateFilter = {
                tanggal_kirim: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`)
                }
            };
        } else if (tanggal_selesai) {
            dateFilter = {
                tanggal_kirim: {
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        }

        const distributions = await prisma.distribusi.findMany({
            where: dateFilter,
            include: {
                transaksi: {
                    include: {
                        detail_transaksi: {
                            include: {
                                barang: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                tanggal_kirim: 'desc'
            }
        });

        const formatted = distributions.map(d => {
            const detailMuatan = d.transaksi?.detail_transaksi?.map(det => 
                `${det.barang.nama_barang} (${det.jumlah} unit)`
            ).join(', ') || '-';

            return {
                tanggal_kirim: d.tanggal_kirim,
                surat_jalan: d.surat_jalan,
                outlet_tujuan: d.outlet_tujuan,
                detail_muatan: detailMuatan,
                driver: d.nama_driver,
                status_pengiriman: d.status_pengiriman
            };
        });

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat laporan rekap distribusi', error: error.message });
    }
});

// 5. Laporan Performa Waktu Pengiriman (Lead Time Analysis)
app.get('/api/reports/lead-time', authenticateToken, isAuthorizedForReports, async (req, res) => {
    try {
        const { tanggal_mulai, tanggal_selesai } = req.query;
        let dateFilter = {};
        if (tanggal_mulai && tanggal_selesai) {
            dateFilter = {
                tanggal_kirim: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`),
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        } else if (tanggal_mulai) {
            dateFilter = {
                tanggal_kirim: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`)
                }
            };
        } else if (tanggal_selesai) {
            dateFilter = {
                tanggal_kirim: {
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        }

        const distributions = await prisma.distribusi.findMany({
            where: dateFilter,
            orderBy: {
                tanggal_kirim: 'desc'
            }
        });

        const formatted = distributions.map(d => {
            let durasiTeks = '-';
            if (d.tanggal_kirim && d.tanggal_diterima) {
                const diffMs = new Date(d.tanggal_diterima) - new Date(d.tanggal_kirim);
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMins / 60);
                const remainingMins = diffMins % 60;
                
                if (diffHours > 0) {
                    durasiTeks = `${diffHours} jam ${remainingMins} menit`;
                } else {
                    durasiTeks = `${diffMins} menit`;
                }
            } else if (d.status_pengiriman === 'Pengiriman') {
                durasiTeks = 'Dalam Pengiriman';
            } else {
                durasiTeks = 'Persiapan';
            }

            return {
                surat_jalan: d.surat_jalan,
                outlet_tujuan: d.outlet_tujuan,
                driver: d.nama_driver,
                waktu_berangkat: d.tanggal_kirim,
                waktu_tiba: d.tanggal_diterima,
                durasi: durasiTeks
            };
        });

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat laporan lead-time', error: error.message });
    }
});

// 6. Laporan Analisis Barang Distribusi Cepat (Fast-Moving)
app.get('/api/reports/fast-moving', authenticateToken, isAuthorizedForReports, async (req, res) => {
    try {
        const { tanggal_mulai, tanggal_selesai } = req.query;
        let dateFilter = {};
        if (tanggal_mulai && tanggal_selesai) {
            dateFilter = {
                transaksi: {
                    tanggal_transaksi: {
                        gte: new Date(`${tanggal_mulai}T00:00:00.000Z`),
                        lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                    }
                }
            };
        } else if (tanggal_mulai) {
            dateFilter = {
                transaksi: {
                    tanggal_transaksi: {
                        gte: new Date(`${tanggal_mulai}T00:00:00.000Z`)
                    }
                }
            };
        } else if (tanggal_selesai) {
            dateFilter = {
                transaksi: {
                    tanggal_transaksi: {
                        lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                    }
                }
            };
        }

        const details = await prisma.detailTransaksiGudang.findMany({
            where: {
                transaksi: {
                    jenis_transaksi: 'OUT'
                },
                ...dateFilter
            },
            include: {
                barang: true
            }
        });

        const agg = {};
        details.forEach(d => {
            const id = d.barang_id;
            if (!agg[id]) {
                agg[id] = {
                    kode_barang: d.barang.kode_barang,
                    nama_barang: d.barang.nama_barang,
                    frekuensi: 0,
                    total_qty: 0
                };
            }
            agg[id].frekuensi += 1;
            agg[id].total_qty += d.jumlah;
        });

        const sorted = Object.values(agg).sort((a, b) => b.total_qty - a.total_qty);

        const formatted = sorted.map((item, index) => ({
            peringkat: index + 1,
            kode_barang: item.kode_barang,
            nama_barang: item.nama_barang,
            frekuensi: item.frekuensi,
            total_qty: item.total_qty
        }));

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat laporan fast-moving', error: error.message });
    }
});

// 7. Laporan Serapan Distribusi Berdasarkan Outlet
app.get('/api/reports/outlet-serapan', authenticateToken, isAuthorizedForReports, async (req, res) => {
    try {
        const { tanggal_mulai, tanggal_selesai } = req.query;
        let dateFilter = {};
        if (tanggal_mulai && tanggal_selesai) {
            dateFilter = {
                tanggal_kirim: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`),
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        } else if (tanggal_mulai) {
            dateFilter = {
                tanggal_kirim: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`)
                }
            };
        } else if (tanggal_selesai) {
            dateFilter = {
                tanggal_kirim: {
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        }

        const distributions = await prisma.distribusi.findMany({
            where: dateFilter,
            include: {
                transaksi: {
                    include: {
                        detail_transaksi: true
                    }
                }
            }
        });

        const outletStats = {};
        distributions.forEach(d => {
            const outlet = d.outlet_tujuan;
            if (!outletStats[outlet]) {
                outletStats[outlet] = {
                    nama_outlet: outlet,
                    kunjungan: 0,
                    total_item: 0
                };
            }
            outletStats[outlet].kunjungan += 1;
            d.transaksi?.detail_transaksi?.forEach(det => {
                outletStats[outlet].total_item += det.jumlah;
            });
        });

        const sorted = Object.values(outletStats).sort((a, b) => b.total_item - a.total_item);
        res.json(sorted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat laporan serapan outlet', error: error.message });
    }
});

// 8. Laporan Produktivitas Log Transaksi Admin Gudang
app.get('/api/reports/admin-productivity', authenticateToken, isAuthorizedForReports, async (req, res) => {
    try {
        const { tanggal_mulai, tanggal_selesai } = req.query;
        let dateFilter = {};
        if (tanggal_mulai && tanggal_selesai) {
            dateFilter = {
                tanggal_transaksi: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`),
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        } else if (tanggal_mulai) {
            dateFilter = {
                tanggal_transaksi: {
                    gte: new Date(`${tanggal_mulai}T00:00:00.000Z`)
                }
            };
        } else if (tanggal_selesai) {
            dateFilter = {
                tanggal_transaksi: {
                    lte: new Date(`${tanggal_selesai}T23:59:59.999Z`)
                }
            };
        }

        const admins = await prisma.user.findMany({
            where: {
                role: 'Admin_Gudang'
            },
            include: {
                transaksi: {
                    where: dateFilter
                }
            }
        });

        const formatted = admins.map(u => {
            const inCount = u.transaksi.filter(t => t.jenis_transaksi === 'IN').length;
            const outCount = u.transaksi.filter(t => t.jenis_transaksi === 'OUT').length;
            
            return {
                nama_admin: u.nama_lengkap,
                jabatan: 'Admin Gudang',
                total_in: inCount,
                total_out: outCount
            };
        }).sort((a, b) => (b.total_in + b.total_out) - (a.total_in + a.total_out));

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat laporan produktivitas admin', error: error.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server administrasi gudang berjalan di http://localhost:${PORT}`);
});

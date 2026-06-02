const { PrismaClient } = require('./generated/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
    console.log('Memulai proses seeding database Supabase...');

    // 1. Clear existing data (optional, but good for clean seed)
    // We truncate tables to prevent duplicate key errors on multiple runs
    console.log('Membersihkan data lama...');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "distribusi", "detail_transaksi_gudang", "transaksi_gudang", "barang", "users" RESTART IDENTITY CASCADE;');

    // 2. Seed Users
    console.log('Menanam data Pengguna (Users)...');
    const passwordHash = await bcrypt.hash('admin123', 10);
    const passwordHashPimpinan = await bcrypt.hash('pimpinan123', 10);

    const admin = await prisma.user.create({
        data: {
            username: 'admin',
            password_hash: passwordHash,
            role: 'Admin_Gudang',
            nama_lengkap: 'Budi Santoso (Admin)'
        }
    });

    const admin1 = await prisma.user.create({
        data: {
            username: 'admin1',
            password_hash: passwordHash,
            role: 'Admin_Gudang',
            nama_lengkap: 'Jajang (Admin 1)'
        }
    });

    const pimpinan = await prisma.user.create({
        data: {
            username: 'pimpinan',
            password_hash: passwordHashPimpinan,
            role: 'Pimpinan',
            nama_lengkap: 'Ir. H. Ahmad Dahlan (Pimpinan)'
        }
    });

    console.log(`Pengguna berhasil dibuat:
- Admin Gudang ID: ${admin.id} (${admin.nama_lengkap})
- Admin 1 ID: ${admin1.id} (${admin1.nama_lengkap})
- Pimpinan ID: ${pimpinan.id} (${pimpinan.nama_lengkap})`);

    // 3. Seed Master Barang
    console.log('Menanam data Master Barang (Inventory)...');
    const items = [
        { kode_barang: 'SKU-001', nama_barang: 'Coca Cola 1.5L', kategori: 'Minuman Bersoda', harga: 15000.00, stok_minimum: 20, stok_sekarang: 150 },
        { kode_barang: 'SKU-002', nama_barang: 'Sprite 1.5L', kategori: 'Minuman Bersoda', harga: 15000.00, stok_minimum: 20, stok_sekarang: 120 },
        { kode_barang: 'SKU-003', nama_barang: 'Fanta Orange 1.5L', kategori: 'Minuman Bersoda', harga: 15000.00, stok_minimum: 20, stok_sekarang: 15 },
        { kode_barang: 'SKU-004', nama_barang: 'Ades Air Mineral 600ml', kategori: 'Air Mineral', harga: 4000.00, stok_minimum: 50, stok_sekarang: 450 },
        { kode_barang: 'SKU-005', nama_barang: 'Pulpy Orange 350ml', kategori: 'Jus Buah', harga: 7000.00, stok_minimum: 30, stok_sekarang: 200 }
    ];

    for (const item of items) {
        const created = await prisma.barang.create({
            data: {
                kode_barang: item.kode_barang,
                nama_barang: item.nama_barang,
                kategori: item.kategori,
                harga: item.harga,
                stok_minimum: item.stok_minimum,
                stok_sekarang: item.stok_sekarang
            }
        });
        console.log(`- Barang dibuat: ${created.kode_barang} (${created.nama_barang})`);
    }

    console.log('Seeding basis data Supabase selesai dengan sukses!');
}

main()
    .catch((e) => {
        console.error('Terjadi kesalahan saat seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

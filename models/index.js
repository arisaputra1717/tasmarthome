const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Koneksi ke SQLite
const dbPath = path.join(__dirname, '../database.sqlite');
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
});

// Cek dan tambahkan kolom jika belum ada
async function ensureColumnExists() {
  // Kolom penjadwalan_aktif di tabel perangkat
  const perangkatTable = 'perangkat';
  const perangkatColumn = 'penjadwalan_aktif';

  const [perangkatResults] = await sequelize.query(`PRAGMA table_info(${perangkatTable})`);
  const perangkatColumnExists = perangkatResults.some(col => col.name === perangkatColumn);

  if (!perangkatColumnExists) {
    await sequelize.query(`ALTER TABLE ${perangkatTable} ADD COLUMN ${perangkatColumn} BOOLEAN DEFAULT 0`);
    console.log(`✅ Kolom '${perangkatColumn}' ditambahkan ke tabel '${perangkatTable}'`);
  }

  // Kolom aktif di tabel penjadwalan
  const penjadwalanTable = 'penjadwalan';
  const penjadwalanColumn = 'aktif';

  const [penjadwalanResults] = await sequelize.query(`PRAGMA table_info(${penjadwalanTable})`);
  const penjadwalanColumnExists = penjadwalanResults.some(col => col.name === penjadwalanColumn);

  if (!penjadwalanColumnExists) {
    await sequelize.query(`ALTER TABLE ${penjadwalanTable} ADD COLUMN ${penjadwalanColumn} BOOLEAN NOT NULL DEFAULT 1`);
    console.log(`✅ Kolom '${penjadwalanColumn}' ditambahkan ke tabel '${penjadwalanTable}'`);
  }
}

// Model Perangkat
const Perangkat = sequelize.define('Perangkat', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  nama_perangkat: { type: DataTypes.STRING, allowNull: false },
  topik_mqtt: { type: DataTypes.STRING, allowNull: false, unique: true },
  topik_kontrol: { type: DataTypes.STRING, allowNull: true },
  prioritas: {
    type: DataTypes.ENUM('Tinggi', 'Sedang', 'Rendah', 'Tidak Ada'),
    defaultValue: 'Tidak Ada'
  },
  daya_watt: DataTypes.FLOAT,
  status: DataTypes.STRING,
  penjadwalan_aktif: { type: DataTypes.BOOLEAN, defaultValue: false }
}, {
  tableName: 'perangkat',
  timestamps: false
});

// Model Data Penggunaan
const DataPenggunaan = sequelize.define('DataPenggunaan', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  perangkat_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'perangkat', key: 'id' },
    onDelete: 'CASCADE'
  },
  volt: DataTypes.FLOAT,
  ampere: DataTypes.FLOAT,
  watt: DataTypes.FLOAT,
  energy: DataTypes.FLOAT,
  energy_delta: DataTypes.FLOAT,
  timestamp: { type: DataTypes.DATE, defaultValue: Sequelize.NOW }
}, {
  tableName: 'data_penggunaan',
  timestamps: false
});

// Model Limit Energi
const LimitEnergi = sequelize.define('LimitEnergi', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  jam_mulai: DataTypes.DATE,
  jam_selesai: DataTypes.DATE,
  batas_kwh: DataTypes.FLOAT
}, {
  tableName: 'limit',
  timestamps: false
});

// ✅ Model Penjadwalan (sudah diperbarui)
const Penjadwalan = sequelize.define('Penjadwalan', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  perangkat_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'perangkat', key: 'id' },
    onDelete: 'CASCADE'
  },
  waktu_nyala: { type: DataTypes.DATE, allowNull: false },
  waktu_mati: { type: DataTypes.DATE, allowNull: false },
  aktif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  tableName: 'penjadwalan',
  timestamps: false
});

// Model Statistik Harian
const StatistikHarian = sequelize.define('StatistikHarian', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tanggal: { type: DataTypes.DATEONLY, allowNull: false },
  total_kwh: { type: DataTypes.FLOAT, defaultValue: 0 }
}, {
  tableName: 'statistik_harian',
  timestamps: false
});

// Relasi
Perangkat.hasMany(DataPenggunaan, { foreignKey: 'perangkat_id' });
DataPenggunaan.belongsTo(Perangkat, { foreignKey: 'perangkat_id' });

Perangkat.hasMany(Penjadwalan, { foreignKey: 'perangkat_id' });
Penjadwalan.belongsTo(Perangkat, { foreignKey: 'perangkat_id' });

// Sync DB
(async () => {
  try {
    await sequelize.sync({ force: false });
    await ensureColumnExists();
    console.log('✅ Model berhasil disinkronisasi');
  } catch (err) {
    console.error('❌ Gagal sinkronisasi DB:', err.message);
    console.log('💡 Jika tabel sudah ada dan struktur berbeda, gunakan script reset-database.js');
  }
})();

module.exports = {
  sequelize,
  Perangkat,
  DataPenggunaan,
  LimitEnergi,
  Penjadwalan,
  StatistikHarian
};

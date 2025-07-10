require('dotenv').config();
const mqtt = require('mqtt');
const { Perangkat, DataPenggunaan, LimitEnergi, Penjadwalan } = require('./models');
const { Op } = require('sequelize');

const client = mqtt.connect(process.env.MQTT_BROKER || 'mqtt://broker.emqx.io:1883', {
  clientId: 'smart-energy-client-' + Math.random().toString(16).substr(2, 8),
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 1000,
  username: process.env.MQTT_USER || undefined,
  password: process.env.MQTT_PASS || undefined,
  protocolId: 'MQTT',
  protocolVersion: 4,
  keepalive: 60,
  rejectUnauthorized: false,
});

// Daftar perangkat yang diblokir karena limit
let perangkatTerblokir = new Set();

// ✅ Subscribe ke semua topik perangkat
client.on('connect', async () => {
  console.log('✅ Terhubung ke MQTT broker');

  try {
    const perangkatList = await Perangkat.findAll();
    perangkatList.forEach(({ topik_mqtt, nama_perangkat }) => {
      const topic = topik_mqtt?.trim();
      if (!topic) {
        console.warn(`⚠️ Perangkat "${nama_perangkat}" tidak memiliki topik_mqtt`);
        return;
      }

      client.subscribe(topic, (err) => {
        if (err) console.error(`❌ Gagal subscribe ke "${topic}":`, err.message);
        else console.log(`📡 Berhasil subscribe ke "${topic}"`);
      });
    });
  } catch (err) {
    console.error('❌ Gagal mengambil perangkat:', err.message);
  }
});

// ✅ Terima data dari perangkat
client.on('message', async (topic, message) => {
  let data;
  try {
    data = JSON.parse(message.toString());
  } catch {
    return console.warn(`⚠️ Data bukan JSON dari topik "${topic}"`);
  }

  const perangkat = await Perangkat.findOne({ where: { topik_mqtt: topic } });
  if (!perangkat) return console.warn(`⚠️ Perangkat untuk topik "${topic}" tidak ditemukan`);

  // Abaikan jika hanya command
  if (data.command) {
    console.log(`📥 Command diterima dari ${perangkat.nama_perangkat}:`, data.command);
    return;
  }

  const isValid = ['volt', 'ampere', 'watt', 'energy'].every(key => typeof data[key] === 'number');
  if (!isValid) return console.warn(`⚠️ Data tidak valid dari "${perangkat.nama_perangkat}"`);

  try {
    const last = await DataPenggunaan.findOne({
      where: { perangkat_id: perangkat.id },
      order: [['timestamp', 'DESC']]
    });

    const energyDelta = last ? Math.max(0, data.energy - last.energy) : 0;

    await DataPenggunaan.create({
      perangkat_id: perangkat.id,
      volt: data.volt,
      ampere: data.ampere,
      watt: data.watt,
      energy: data.energy,
      energy_delta: energyDelta
    });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const totalToday = await DataPenggunaan.sum('energy_delta', {
      where: { timestamp: { [Op.gte]: today } }
    });

    // Cek batas limit
    const limit = await LimitEnergi.findOne({
      where: {
        jam_mulai: { [Op.lte]: new Date() },
        jam_selesai: { [Op.gte]: new Date() }
      },
      order: [['jam_mulai', 'DESC']]
    });

    if (limit) {
      const persen = (totalToday / limit.batas_kwh) * 100;
      if (persen >= 100) {
        await matikanBerdasarkanPrioritas(1, client);  // Matikan semua
      } else if (persen >= 80) {
        await matikanBerdasarkanPrioritas(2, client);  // Matikan Sedang + Rendah
      } else if (persen >= 60) {
        await matikanBerdasarkanPrioritas(3, client);  // Matikan Rendah saja
      }
    }

    // Kirim ke browser
    if (global.io) {
      global.io.emit('data-terbaru', {
        perangkat_id: perangkat.id,
        nama_perangkat: perangkat.nama_perangkat,
        volt: data.volt,
        ampere: data.ampere,
        watt: data.watt,
        energy: data.energy,
        energy_delta: energyDelta,
        timestamp: new Date().toISOString(),
        penjadwalan_aktif: perangkat.penjadwalan_aktif,
        prioritas: perangkat.prioritas
      });

      global.io.emit('totalEnergiUpdate', {
        total: totalToday.toFixed(2)
      });
    }

  } catch (err) {
    console.error(`❌ Gagal menyimpan data dari "${perangkat.nama_perangkat}":`, err.message);
  }
});

// ✅ Fungsi untuk mematikan berdasarkan prioritas STRING
async function matikanBerdasarkanPrioritas(level, client) {
  let prioritasArray;
  
  // Mapping level ke prioritas yang akan dimatikan
  switch(level) {
    case 3: // 60% - matikan prioritas 'Rendah'
      prioritasArray = ['Rendah'];
      break;
    case 2: // 80% - matikan prioritas 'Sedang' dan 'Rendah'  
      prioritasArray = ['Sedang', 'Rendah'];
      break;
    case 1: // 100% - matikan semua prioritas
      prioritasArray = ['Tinggi', 'Sedang', 'Rendah'];
      break;
    default:
      return;
  }

  const perangkatList = await Perangkat.findAll({
    where: {
      prioritas: { [Op.in]: prioritasArray }, // Gunakan Op.in untuk array string
      status: 'ON'
    }
  });

  for (const perangkat of perangkatList) {
    await perangkat.update({ status: 'OFF' });
    perangkatTerblokir.add(perangkat.id);

    if (perangkat.topik_kontrol) {
      client.publish(perangkat.topik_kontrol, JSON.stringify({ command: 'OFF' }));
      console.log(`📤 [LIMIT] OFF ke ${perangkat.topik_kontrol} (${perangkat.nama_perangkat}) - Prioritas: ${perangkat.prioritas}`);
    } else {
      console.warn(`⚠️ Tidak ada topik_kontrol untuk ${perangkat.nama_perangkat}`);
    }
  }
}

// ✅ Penjadwalan otomatis tiap 60 detik
setInterval(async () => {
  const now = new Date();

  try {
    const jadwalAktif = await Penjadwalan.findAll({
      where: {
        waktu_nyala: { [Op.lte]: now },
        waktu_mati: { [Op.gte]: now },
        aktif: true
      }
    });

    const perangkatAktif = jadwalAktif.map(j => j.perangkat_id);
    const semuaPerangkat = await Perangkat.findAll();

    for (const perangkat of semuaPerangkat) {
      const dalamJadwal = perangkatAktif.includes(perangkat.id);

      if (dalamJadwal && perangkat.status !== 'ON') {
        if (!perangkatTerblokir.has(perangkat.id)) {
          await perangkat.update({ status: 'ON' });

          if (perangkat.topik_kontrol) {
            client.publish(perangkat.topik_kontrol, JSON.stringify({ command: 'ON' }));
            console.log(`📤 [JADWAL] ON ke ${perangkat.topik_kontrol} (${perangkat.nama_perangkat})`);
          }
        } else {
          console.log(`⚠️ [JADWAL] ${perangkat.nama_perangkat} diblokir karena limit, tidak bisa ON`);
        }
      }

      if (!dalamJadwal && perangkat.status !== 'OFF') {
        await perangkat.update({ status: 'OFF' });

        if (perangkat.topik_kontrol) {
          client.publish(perangkat.topik_kontrol, JSON.stringify({ command: 'OFF' }));
          console.log(`📤 [JADWAL] OFF ke ${perangkat.topik_kontrol} (${perangkat.nama_perangkat})`);
        }
      }
    }

  } catch (err) {
    console.error('❌ Gagal eksekusi penjadwalan:', err.message);
  }
}, 60 * 1000); // tiap 60 detik

module.exports = client;
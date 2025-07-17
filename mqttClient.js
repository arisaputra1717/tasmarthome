
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

  // ✅ Query perangkat selalu live dari database
  const perangkat = await Perangkat.findOne({ where: { topik_mqtt: topic } });
  if (!perangkat) return console.warn(`⚠️ Perangkat tidak ditemukan untuk topik "${topic}"`);

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
  switch(level) {
    case 3: prioritasArray = ['Rendah']; break;
    case 2: prioritasArray = ['Sedang', 'Rendah']; break;
    case 1: prioritasArray = ['Tinggi', 'Sedang', 'Rendah']; break;
    default: return;
  }

  const semuaPerangkat = await Perangkat.findAll();

  for (const perangkat of semuaPerangkat) {
    const punyaJadwal = await Penjadwalan.findOne({ where: { perangkat_id: perangkat.id, aktif: true } });

    if (!punyaJadwal) {
      console.log(`✅ [LIMIT BYPASS] ${perangkat.nama_perangkat} tidak punya jadwal, tidak dikontrol limit energi.`);
      continue;
    }

    if (prioritasArray.includes(perangkat.prioritas) && perangkat.status === 'ON') {
      await perangkat.update({ status: 'OFF' });
      if (perangkat.topik_kontrol) {
        client.publish(perangkat.topik_kontrol, JSON.stringify({ command: 'OFF' }));
        console.log(`📤 [LIMIT] OFF ke ${perangkat.topik_kontrol} (${perangkat.nama_perangkat})`);
      }
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
      const punyaJadwal = await Penjadwalan.findOne({ where: { perangkat_id: perangkat.id, aktif: true } });

      if (!punyaJadwal) {
        console.log(`✅ [BYPASS] ${perangkat.nama_perangkat} tidak punya jadwal, tidak dikontrol penjadwalan.`);
        continue;
      }

      const dalamJadwal = perangkatAktif.includes(perangkat.id);

      if (dalamJadwal && perangkat.status !== 'ON') {
        await perangkat.update({ status: 'ON' });
        if (perangkat.topik_kontrol) {
          client.publish(perangkat.topik_kontrol, JSON.stringify({ command: 'ON' }));
          console.log(`📤 [JADWAL] ON ke ${perangkat.topik_kontrol} (${perangkat.nama_perangkat})`);
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
}, 60 * 1000);
// ✅ Fungsi untuk subscribe ulang topik perangkat setelah penambahan
async function subscribeTopikBaru() {
  const perangkatList = await Perangkat.findAll();
  perangkatList.forEach(({ topik_mqtt, nama_perangkat }) => {
    if (topik_mqtt) {
      client.subscribe(topik_mqtt, (err) => {
        if (!err) {
          console.log(`✅ [AUTO SUBSCRIBE] ${nama_perangkat} : ${topik_mqtt}`);
        }
      });
    }
  });
}
setInterval(async () => {
  console.log('🔄 Refresh subscribe perangkat...');
  await subscribeTopikBaru();
}, 60 * 1000);
// ✅ Tambahan handler toggle perangkat dengan pengecekan MQTT aman
async function togglePerangkat(req, res) {
  try {
    const perangkat = await Perangkat.findByPk(req.params.id);
    if (!perangkat) return res.status(404).send('❌ Perangkat tidak ditemukan');
    if (!perangkat.topik_kontrol) return res.status(400).send('❌ Topik kontrol belum diatur');

    if (!client.connected) {
      console.warn('❌ MQTT Client belum terhubung, tidak bisa kirim perintah');
      return res.status(500).send('❌ MQTT tidak terhubung');
    }

    const statusBaru = perangkat.status === 'ON' ? 'OFF' : 'ON';
    await perangkat.update({ status: statusBaru });

    client.publish(perangkat.topik_kontrol, JSON.stringify({ command: statusBaru }), (err) => {
      if (err) {
        console.error('❌ Gagal publish MQTT:', err.message);
        return res.status(500).send('❌ Gagal publish MQTT: ' + err.message);
      }
      console.log(`📤 [TOGGLE] ${perangkat.nama_perangkat} diubah ke ${statusBaru}`);
      res.json({ status: 'sukses', statusBaru });
    });

  } catch (err) {
    console.error('❌ Toggle error:', err.message);
    res.status(500).send('❌ Terjadi kesalahan server: ' + err.message);
  }
}
// ✅ Export fungsi agar bisa dipakai controller
module.exports = { client, subscribeTopikBaru };

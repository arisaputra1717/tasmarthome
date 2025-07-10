const { Perangkat, DataPenggunaan, LimitEnergi, Penjadwalan } = require('../models');
const { Op } = require('sequelize');

function formatJamMenit(date) {
  return date.toTimeString().slice(0, 5);
}

exports.index = async (req, res) => {
  try {
    const now = new Date();
    const hariIniJamMenit = formatJamMenit(now);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Jalankan penjadwalan otomatis
    const semuaJadwal = await Penjadwalan.findAll({
      where: { aktif: true },
      include: [Perangkat],
    });

    for (const jadwal of semuaJadwal) {
      const waktuNyala = formatJamMenit(jadwal.waktu_nyala);
      const waktuMati = formatJamMenit(jadwal.waktu_mati);
      const dalamWaktu = hariIniJamMenit >= waktuNyala && hariIniJamMenit <= waktuMati;

      if (jadwal.Perangkat) {
        if (dalamWaktu && jadwal.Perangkat.status !== 'ON') {
          await jadwal.Perangkat.update({ status: 'ON' });
        } else if (!dalamWaktu && jadwal.Perangkat.status !== 'OFF') {
          await jadwal.Perangkat.update({ status: 'OFF' });
        }
      }
    }

    // Ambil semua perangkat dan data penggunaan
    const perangkatDanData = await Perangkat.findAll({
      include: [{
        model: DataPenggunaan,
        attributes: ['volt', 'ampere', 'watt', 'energy', 'timestamp'],
        limit: 1,
        order: [['timestamp', 'DESC']],
        required: false,
      }],
      order: [['nama_perangkat', 'ASC']],
    });

    // Hitung total energi hari ini
    const totalEnergiHariIni = await DataPenggunaan.sum('energy_delta', {
      where: { timestamp: { [Op.gte]: today } },
    }) || 0;

    // Cek limit energi yang aktif
    const limitAktif = await LimitEnergi.findOne({
      where: {
        jam_mulai: { [Op.lte]: now },
        jam_selesai: { [Op.gte]: now },
      },
    });

    let persentasePemakaian = null;
    if (limitAktif && limitAktif.batas_kwh > 0) {
      persentasePemakaian = Math.min(100, (totalEnergiHariIni / limitAktif.batas_kwh) * 100);
    }

    // ✅ Fungsi untuk menentukan apakah perangkat diblokir oleh limit
    function isPerangkatDiblokirLimit(prioritas, persentase) {
      if (!persentase) return false;
      
      if (persentase >= 100) {
        // 100% - semua perangkat diblokir
        return ['Tinggi', 'Sedang', 'Rendah'].includes(prioritas);
      } else if (persentase >= 80) {
        // 80% - prioritas Sedang dan Rendah diblokir
        return ['Sedang', 'Rendah'].includes(prioritas);
      } else if (persentase >= 60) {
        // 60% - prioritas Rendah diblokir
        return prioritas === 'Rendah';
      }
      
      return false;
    }

    // Cek apakah masing-masing perangkat punya penjadwalan aktif
    const dataTerbaru = await Promise.all(
      perangkatDanData.map(async (p) => {
        const adaPenjadwalan = await Penjadwalan.findOne({
          where: {
            perangkat_id: p.id,
            aktif: true,
          },
        });

        // ✅ Cek apakah perangkat diblokir oleh limit
        const diblokirLimit = isPerangkatDiblokirLimit(p.prioritas, persentasePemakaian);

        return {
          perangkat: {
            id: p.id,
            nama_perangkat: p.nama_perangkat,
            status: p.status || 'OFF',
            prioritas: p.prioritas,
            penjadwalan_aktif: !!adaPenjadwalan,
            daya_watt: p.daya_watt,
            diblokir_limit: diblokirLimit, // ✅ Status pemblokiran
          },
          data: p.DataPenggunaans[0] || null,
        };
      })
    );

    // Ambil data grafik energi
    const chartData = await Promise.all(
      perangkatDanData.map(async (p) => {
        const recentData = await DataPenggunaan.findAll({
          where: { perangkat_id: p.id },
          attributes: ['energy', 'timestamp'],
          order: [['timestamp', 'DESC']],
          limit: 20,
        });

        return {
          perangkat_id: p.id,
          nama_perangkat: p.nama_perangkat,
          labels: recentData.map(d => new Date(d.timestamp).toLocaleTimeString()).reverse(),
          data: recentData.map(d => d.energy).reverse(),
        };
      })
    );

    res.render('dashboard/index', {
      dataTerbaru,
      totalEnergiHariIni,
      limit: limitAktif,
      persenLimit: persentasePemakaian ? persentasePemakaian.toFixed(1) : null,
      chartData: JSON.stringify(chartData),
    });

  } catch (err) {
    console.error('❌ Error in dashboardController:', err.stack);
    res.status(500).render('error', {
      title: 'Smart Energy',
      error: 'Gagal memuat dashboard: ' + err.message
    });
  }
};
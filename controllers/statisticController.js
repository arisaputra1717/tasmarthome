const { DataPenggunaan, Perangkat, LimitEnergi } = require('../models');
const { Op } = require('sequelize');

exports.index = async (req, res) => {
  try {
    const perangkat = await Perangkat.findAll();
    res.render('statistic/index', { title: 'Statistik Energi', perangkat });
  } catch (err) {
    res.status(500).send('Gagal load halaman statistik');
  }
};

exports.getChartData = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Ambil limit aktif hari ini
    const limit = await LimitEnergi.findOne({
      where: {
        jam_mulai: { [Op.lte]: new Date() },
        jam_selesai: { [Op.gte]: new Date() }
      },
      order: [['jam_mulai', 'DESC']]
    });

    // Ambil data energi tiap jam hari ini
    const data = await DataPenggunaan.findAll({
      attributes: ['timestamp', 'energy_delta'],
      where: {
        timestamp: { [Op.gte]: today }
      },
      order: [['timestamp', 'ASC']]
    });

    // Group by hour
    const grouped = {};
    for (let row of data) {
      const hour = new Date(row.timestamp).getHours();
      grouped[hour] = (grouped[hour] || 0) + row.energy_delta;
    }

    const labels = [...Array(24).keys()].map(h => `${h}:00`);
    const values = labels.map((_, h) => parseFloat((grouped[h] || 0).toFixed(2)));

    const total = values.reduce((sum, val) => sum + val, 0);
    const limitKwh = limit?.batas_kwh || 0;
    const percent = limitKwh ? (total / limitKwh) * 100 : 0;
    const status = limitKwh
      ? percent >= 100 ? '⚠️ Melebihi limit'
      : percent >= 80 ? '⚠️ Hampir habis'
      : '✅ Hemat'
      : '-';

    res.json({
      labels,
      values,
      total: total.toFixed(2),
      limit: limitKwh,
      percent: percent.toFixed(1),
      status
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal ambil data statistik' });
  }
};

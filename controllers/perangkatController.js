const { Perangkat } = require('../models');
const mqttClient = require('../mqttClient');

// TAMPILKAN SEMUA PERANGKAT
exports.index = async (req, res) => {
  const perangkat = await Perangkat.findAll();
  res.render('perangkat/index', { perangkat });
};

// FORM TAMBAH
exports.createForm = (req, res) => {
  res.render('perangkat/create');
};

// PROSES TAMBAH
exports.create = async (req, res) => {
  try {
    const data = {
      nama_perangkat: req.body.nama_perangkat,
      topik_mqtt: req.body.topik_mqtt,
      topik_kontrol: req.body.topik_kontrol || null,
      prioritas: req.body.prioritas || null,
      daya_watt: parseFloat(req.body.daya_watt) || 0,
      status: req.body.status || 'OFF',
    };

    await Perangkat.create(data);
    res.redirect('/perangkat');
  } catch (err) {
    console.error('❌ Gagal membuat perangkat:', err.message);
    res.status(500).send('Gagal membuat perangkat');
  }
};

// FORM EDIT
exports.editForm = async (req, res) => {
  const perangkat = await Perangkat.findByPk(req.params.id);
  if (!perangkat) return res.status(404).send('Perangkat tidak ditemukan');
  res.render('perangkat/edit', { perangkat });
};

// PROSES EDIT
exports.edit = async (req, res) => {
  const perangkat = await Perangkat.findByPk(req.params.id);
  if (!perangkat) return res.status(404).send('Perangkat tidak ditemukan');

  try {
    const data = {
      nama_perangkat: req.body.nama_perangkat,
      topik_mqtt: req.body.topik_mqtt,
      topik_kontrol: req.body.topik_kontrol || null,
      prioritas: req.body.prioritas || null,
      daya_watt: parseFloat(req.body.daya_watt) || 0,
      status: req.body.status || perangkat.status,
    };

    await perangkat.update(data);
    res.redirect('/perangkat');
  } catch (err) {
    console.error('❌ Gagal update perangkat:', err.message);
    res.status(500).send('Gagal mengupdate perangkat');
  }
};

// HAPUS
exports.delete = async (req, res) => {
  const perangkat = await Perangkat.findByPk(req.params.id);
  if (!perangkat) return res.status(404).send('Perangkat tidak ditemukan');
  await perangkat.destroy();
  res.redirect('/perangkat');
};

// TOGGLE STATUS PERANGKAT
exports.toggle = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const perangkat = await Perangkat.findByPk(id);
    if (!perangkat) {
      return res.status(404).json({
        success: false,
        message: 'Perangkat tidak ditemukan'
      });
    }

    if (!['ON', 'OFF'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status tidak valid. Hanya ON atau OFF yang diizinkan'
      });
    }

    perangkat.status = status;
    await perangkat.save();

    if (perangkat.topik_kontrol) {
      mqttClient.publish(perangkat.topik_kontrol, status);
      console.log(`📢 Perintah ${status} dikirim ke ${perangkat.topik_kontrol}`);
    } else {
      console.warn('⚠️ Topik kontrol tidak tersedia untuk perangkat ini');
    }

    res.json({
      success: true,
      newStatus: status
    });

  } catch (error) {
    console.error('❌ Gagal mengubah status:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: error.message
    });
  }
};

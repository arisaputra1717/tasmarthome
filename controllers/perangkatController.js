const { Perangkat, DataPenggunaan, Penjadwalan } = require('../models');
const mqttClient = require('../mqttClient');

// TAMPILKAN SEMUA PERANGKAT
exports.index = async (req, res) => {
  try {
    const perangkat = await Perangkat.findAll();
    res.render('perangkat/index', { perangkat });
  } catch (err) {
    console.error('❌ Gagal mengambil data perangkat:', err.message);
    res.status(500).send('Gagal mengambil data perangkat');
  }
};

// FORM TAMBAH
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
    console.log(`✅ Perangkat "${data.nama_perangkat}" berhasil dibuat`);

    res.redirect('/perangkat');
  } catch (err) {
    console.error('❌ Gagal membuat perangkat:', err.message);
    res.status(500).send('Gagal membuat perangkat: ' + err.message);
  }
};

// FORM EDIT
exports.editForm = async (req, res) => {
  try {
    const perangkat = await Perangkat.findByPk(req.params.id);
    if (!perangkat) return res.status(404).send('Perangkat tidak ditemukan');
    res.render('perangkat/edit', { perangkat });
  } catch (err) {
    console.error('❌ Gagal mengambil data perangkat untuk edit:', err.message);
    res.status(500).send('Gagal mengambil data perangkat');
  }
};

// PROSES EDIT
exports.edit = async (req, res) => {
  try {
    const perangkat = await Perangkat.findByPk(req.params.id);
    if (!perangkat) return res.status(404).send('Perangkat tidak ditemukan');

    const data = {
      nama_perangkat: req.body.nama_perangkat,
      topik_mqtt: req.body.topik_mqtt,
      topik_kontrol: req.body.topik_kontrol || null,
      prioritas: req.body.prioritas || null,
      daya_watt: parseFloat(req.body.daya_watt) || 0,
      status: req.body.status || perangkat.status,
    };

    await perangkat.update(data);
    console.log(`✅ Perangkat "${data.nama_perangkat}" berhasil diupdate`);

    res.redirect('/perangkat');
  } catch (err) {
    console.error('❌ Gagal update perangkat:', err.message);
    res.status(500).send('Gagal mengupdate perangkat: ' + err.message);
  }
};

// HAPUS
exports.delete = async (req, res) => {
  try {
    const perangkat = await Perangkat.findByPk(req.params.id);
    if (!perangkat) return res.status(404).send('Perangkat tidak ditemukan');

    const namaPerangkat = perangkat.nama_perangkat;

    // Hapus data terkait secara manual untuk menghindari foreign key constraint
    await DataPenggunaan.destroy({ where: { perangkat_id: req.params.id } });
    console.log(`🗑️ Data penggunaan untuk perangkat ID ${req.params.id} dihapus`);
    
    await Penjadwalan.destroy({ where: { perangkat_id: req.params.id } });
    console.log(`🗑️ Data penjadwalan untuk perangkat ID ${req.params.id} dihapus`);

    // Baru hapus perangkat
    await perangkat.destroy();
    console.log(`✅ Perangkat "${namaPerangkat}" berhasil dihapus`);

    res.redirect('/perangkat');
  } catch (err) {
    console.error('❌ Gagal menghapus perangkat:', err.message);
    res.status(500).send('Gagal menghapus perangkat: ' + err.message);
  }
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
      newStatus: status,
      message: `Status perangkat berhasil diubah ke ${status}`
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

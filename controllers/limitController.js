const { LimitEnergi } = require('../models');

// GET semua limit
exports.index = async (req, res) => {
  try {
    const limitList = await LimitEnergi.findAll();
    res.render('limit/index', { limitList });
  } catch (err) {
    res.status(500).send('Gagal mengambil data limit');
  }
};

// GET edit form
exports.edit = async (req, res) => {
  try {
    const limit = await LimitEnergi.findByPk(req.params.id);
    if (!limit) return res.status(404).send('Data tidak ditemukan');
    res.render('limit/edit', { limit });
  } catch (err) {
    res.status(500).send('Gagal mengambil data untuk diedit');
  }
};

// POST tambah limit
exports.store = async (req, res) => {
  try {
    const { batas_kwh, jam_mulai, jam_selesai } = req.body;
    await LimitEnergi.create({ batas_kwh, jam_mulai, jam_selesai });
    res.redirect('/limit');
  } catch (err) {
    res.status(500).send('Gagal menyimpan data');
  }
};

// POST update limit
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { batas_kwh, jam_mulai, jam_selesai } = req.body;
    await LimitEnergi.update(
      { batas_kwh, jam_mulai, jam_selesai },
      { where: { id } }
    );
    res.redirect('/limit');
  } catch (err) {
    res.status(500).send('Gagal mengubah data');
  }
};

// POST delete limit
exports.destroy = async (req, res) => {
  try {
    await LimitEnergi.destroy({ where: { id: req.params.id } });
    res.redirect('/limit');
  } catch (err) {
    res.status(500).send('Gagal menghapus');
  }
};

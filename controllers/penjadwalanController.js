const { Penjadwalan, Perangkat } = require('../models');
const { Op } = require('sequelize');

// TAMPILKAN SEMUA JADWAL
exports.index = async (req, res) => {
  try {
    const penjadwalan = await Penjadwalan.findAll({
      include: [{
        model: Perangkat,
        attributes: ['id', 'nama_perangkat', 'topik_mqtt', 'penjadwalan_aktif']
      }],
      order: [['waktu_nyala', 'ASC']]
    });

    const perangkat = await Perangkat.findAll({
      attributes: ['id', 'nama_perangkat', 'topik_mqtt', 'penjadwalan_aktif'],
      order: [['nama_perangkat', 'ASC']]
    });

    res.render('penjadwalan/index', { penjadwalan, perangkat });
  } catch (err) {
    console.error('❌ Gagal memuat penjadwalan:', err.message);
    res.status(500).send('Gagal memuat penjadwalan');
  }
};

// FORM TAMBAH
exports.createForm = async (req, res) => {
  try {
    const perangkatList = await Perangkat.findAll({
      attributes: ['id', 'nama_perangkat', 'topik_mqtt', 'penjadwalan_aktif'],
      order: [['nama_perangkat', 'ASC']]
    });

    res.render('penjadwalan/create', { perangkatList });
  } catch (err) {
    console.error('❌ Gagal menampilkan form tambah jadwal:', err.message);
    res.status(500).send('Gagal menampilkan form tambah jadwal');
  }
};

// PROSES TAMBAH
exports.create = async (req, res) => {
  try {
    const { perangkat_id, waktu_nyala, waktu_mati } = req.body;
    const aktif = req.body.aktif === '1';

    if (!perangkat_id || !waktu_nyala || !waktu_mati) {
      return res.status(400).send('Perangkat, waktu nyala, dan waktu mati wajib diisi');
    }

    const perangkat = await Perangkat.findByPk(perangkat_id);
    if (!perangkat) {
      return res.status(400).send('Perangkat tidak ditemukan');
    }

    const timeStart = new Date(waktu_nyala);
    const timeEnd = new Date(waktu_mati);

    if (timeStart >= timeEnd) {
      return res.status(400).send('Waktu nyala harus lebih awal dari waktu mati');
    }

    const conflictSchedule = await Penjadwalan.findOne({
      where: {
        perangkat_id,
        [Op.or]: [
          { waktu_nyala: { [Op.between]: [timeStart, timeEnd] } },
          { waktu_mati: { [Op.between]: [timeStart, timeEnd] } },
          {
            [Op.and]: [
              { waktu_nyala: { [Op.lte]: timeStart } },
              { waktu_mati: { [Op.gte]: timeEnd } }
            ]
          }
        ]
      }
    });

    if (conflictSchedule) {
      return res.status(400).send('Jadwal bentrok dengan jadwal lain untuk perangkat ini');
    }

    await Penjadwalan.create({
      perangkat_id,
      waktu_nyala: timeStart,
      waktu_mati: timeEnd,
      aktif
    });

    res.redirect('/penjadwalan');
  } catch (err) {
    console.error('❌ Gagal membuat jadwal:', err.message);
    res.status(500).send('Gagal membuat jadwal');
  }
};

// FORM EDIT
exports.editForm = async (req, res) => {
  try {
    const jadwal = await Penjadwalan.findByPk(req.params.id, {
      include: [{ model: Perangkat }]
    });

    if (!jadwal) return res.status(404).send('Jadwal tidak ditemukan');

    const perangkatList = await Perangkat.findAll({
      attributes: ['id', 'nama_perangkat'],
      order: [['nama_perangkat', 'ASC']]
    });

    res.render('penjadwalan/edit', { jadwal, perangkatList });
  } catch (err) {
    console.error('❌ Gagal menampilkan form edit:', err.message);
    res.status(500).send('Gagal menampilkan form edit jadwal');
  }
};

// PROSES EDIT
exports.edit = async (req, res) => {
  try {
    const jadwal = await Penjadwalan.findByPk(req.params.id);
    if (!jadwal) return res.status(404).send('Jadwal tidak ditemukan');

    const { perangkat_id, waktu_nyala, waktu_mati } = req.body;
    const aktif = req.body.aktif === '1';

    if (!perangkat_id || !waktu_nyala || !waktu_mati) {
      return res.status(400).send('Perangkat, waktu nyala, dan waktu mati wajib diisi');
    }

    const timeStart = new Date(waktu_nyala);
    const timeEnd = new Date(waktu_mati);

    if (timeStart >= timeEnd) {
      return res.status(400).send('Waktu nyala harus lebih awal dari waktu mati');
    }

    const conflictSchedule = await Penjadwalan.findOne({
      where: {
        perangkat_id,
        id: { [Op.ne]: req.params.id },
        [Op.or]: [
          { waktu_nyala: { [Op.between]: [timeStart, timeEnd] } },
          { waktu_mati: { [Op.between]: [timeStart, timeEnd] } },
          {
            [Op.and]: [
              { waktu_nyala: { [Op.lte]: timeStart } },
              { waktu_mati: { [Op.gte]: timeEnd } }
            ]
          }
        ]
      }
    });

    if (conflictSchedule) {
      return res.status(400).send('Jadwal bentrok dengan jadwal lain untuk perangkat ini');
    }

    await jadwal.update({
      perangkat_id,
      waktu_nyala: timeStart,
      waktu_mati: timeEnd,
      aktif
    });

    res.redirect('/penjadwalan');
  } catch (err) {
    console.error('❌ Gagal mengupdate jadwal:', err.message);
    res.status(500).send('Gagal mengupdate jadwal');
  }
};

// HAPUS
exports.delete = async (req, res) => {
  try {
    const jadwal = await Penjadwalan.findByPk(req.params.id);
    if (!jadwal) return res.status(404).send('Jadwal tidak ditemukan');

    await jadwal.destroy();
    res.redirect('/penjadwalan');
  } catch (err) {
    console.error('❌ Gagal menghapus jadwal:', err.message);
    res.status(500).send('Gagal menghapus jadwal');
  }
};

// TOGGLE AKTIF/NONAKTIF
exports.toggle = async (req, res) => {
  try {
    const jadwal = await Penjadwalan.findByPk(req.params.id);
    if (!jadwal) return res.status(404).send('Jadwal tidak ditemukan');

    await jadwal.update({ aktif: !jadwal.aktif });

    res.redirect('/penjadwalan');
  } catch (err) {
    console.error('❌ Gagal toggle jadwal:', err.message);
    res.status(500).send('Gagal toggle jadwal');
  }
};

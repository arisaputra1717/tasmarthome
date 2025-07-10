const { Perangkat, DataPenggunaan, LimitEnergi } = require('../models');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

exports.index = async (req, res) => {
  try {
    const limitList = await LimitEnergi.findAll({ order: [['jam_mulai', 'DESC']] });
    const selectedId = req.query.limit_id || limitList[0]?.id;
    const limit = await LimitEnergi.findByPk(selectedId);

    if (!limit) {
      return res.render('laporan/index', {
        data: [],
        limitList,
        selectedId,
        limitInfo: null
      });
    }

    const data = await DataPenggunaan.findAll({
      where: {
        timestamp: {
          [Op.between]: [limit.jam_mulai, limit.jam_selesai]
        }
      },
      order: [['timestamp', 'DESC']]
    });

    const totalEnergy = data.reduce((acc, d) => acc + (d.energy_delta || 0), 0);
    const persen = (totalEnergy / limit.batas_kwh) * 100;
    const statusHemat = totalEnergy <= limit.batas_kwh ? '✅ Hemat' : '❌ Boros';

    res.render('laporan/index', {
      data,
      limitList,
      selectedId,
      limitInfo: {
        batas: limit.batas_kwh,
        terpakai: totalEnergy,
        persen: persen.toFixed(2),
        status: statusHemat,
        periode: {
          dari: limit.jam_mulai,
          sampai: limit.jam_selesai
        }
      }
    });

  } catch (err) {
    console.error('❌ Gagal mengambil laporan:', err.message);
    res.status(500).send('Terjadi kesalahan saat mengambil laporan.');
  }
};

exports.exportExcel = async (req, res) => {
  try {
    const limit = await LimitEnergi.findByPk(req.query.limit_id);
    if (!limit) return res.status(404).send('Limit tidak ditemukan');

    const data = await DataPenggunaan.findAll({
      where: {
        timestamp: { [Op.between]: [limit.jam_mulai, limit.jam_selesai] }
      },
      order: [['timestamp', 'ASC']]
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Laporan Energi');

    sheet.columns = [
      { header: 'Tanggal', key: 'tanggal', width: 20 },
      { header: 'ID Perangkat', key: 'perangkat_id' },
      { header: 'Volt', key: 'volt' },
      { header: 'Ampere', key: 'ampere' },
      { header: 'Watt', key: 'watt' },
      { header: 'Energy Δ (kWh)', key: 'energy_delta' }
    ];

    data.forEach(d => {
      sheet.addRow({
        tanggal: d.timestamp,
        perangkat_id: d.perangkat_id,
        volt: d.volt,
        ampere: d.ampere,
        watt: d.watt,
        energy_delta: d.energy_delta
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Laporan_Limit_${limit.id}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('❌ Gagal export Excel:', err.message);
    res.status(500).send('Gagal export Excel');
  }
};

exports.exportPDF = async (req, res) => {
  try {
    const limit = await LimitEnergi.findByPk(req.query.limit_id);
    if (!limit) return res.status(404).send('Limit tidak ditemukan');

    const data = await DataPenggunaan.findAll({
      where: {
        timestamp: { [Op.between]: [limit.jam_mulai, limit.jam_selesai] }
      },
      order: [['timestamp', 'ASC']]
    });

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Laporan_Limit_${limit.id}.pdf`);
    doc.pipe(res);

    doc.fontSize(16).text(`Laporan Energi Berdasarkan Limit`, { align: 'center' });
    doc.fontSize(12).text(`Periode: ${limit.jam_mulai.toLocaleString()} - ${limit.jam_selesai.toLocaleString()}`);
    doc.moveDown();

    data.forEach(d => {
      doc.text(`${d.timestamp.toLocaleString()} | Perangkat ${d.perangkat_id} | Volt: ${d.volt} | Ampere: ${d.ampere} | Watt: ${d.watt} | Δ: ${d.energy_delta}`);
    });

    doc.end();
  } catch (err) {
    console.error('❌ Gagal export PDF:', err.message);
    res.status(500).send('Gagal export PDF');
  }
};

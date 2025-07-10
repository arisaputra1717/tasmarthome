const express = require('express');
const router = express.Router();
const laporanController = require('../controllers/laporanController');

router.get('/', laporanController.index);
router.get('/export/excel', laporanController.exportExcel);
router.get('/export/pdf', laporanController.exportPDF);

module.exports = router;

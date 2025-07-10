const express = require('express');
const router = express.Router();
const statisticController = require('../controllers/statisticController');

router.get('/', statisticController.index);
router.get('/data', statisticController.getChartData); // endpoint AJAX untuk grafik

module.exports = router;

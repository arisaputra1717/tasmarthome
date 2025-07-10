const express = require('express');
const router = express.Router();
const perangkatController = require('../controllers/perangkatController');

router.get('/', perangkatController.index);
router.get('/create', perangkatController.createForm);
router.post('/create', perangkatController.create);
router.get('/:id/edit', perangkatController.editForm);
router.post('/:id/edit', perangkatController.edit);
router.get('/:id/delete', perangkatController.delete);

// Route penting!
router.post('/:id/toggle', perangkatController.toggle);

module.exports = router;

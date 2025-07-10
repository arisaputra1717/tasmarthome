let pendingDeviceId = null;
let pendingCommand = null;

document.addEventListener('DOMContentLoaded', () => {
    // Event listener untuk tombol ON/OFF perangkat
    document.querySelectorAll('button[data-device-id]').forEach(button => {
        button.addEventListener('click', () => {
            const id = button.getAttribute('data-device-id');
            const command = button.getAttribute('data-command');
            const isPenjadwalanAktif = button.getAttribute('data-penjadwalan') === 'true';

            // Jika perangkat memiliki penjadwalan aktif, tampilkan modal konfirmasi
            if (isPenjadwalanAktif) {
                pendingDeviceId = id;
                pendingCommand = command;
                const modal = new bootstrap.Modal(document.getElementById('modalKonfirmasiManual'));
                modal.show();
            } else {
                kirimPerintah(id, command);
            }
        });
    });

    // Event listener untuk tombol konfirmasi di modal
    document.getElementById('btnKonfirmasiManual')?.addEventListener('click', () => {
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalKonfirmasiManual'));
        modal.hide();
        if (pendingDeviceId && pendingCommand) {
            kirimPerintah(pendingDeviceId, pendingCommand);
            pendingDeviceId = null;
            pendingCommand = null;
        }
    });

    // Inisialisasi Socket.IO
    const socket = io();

    // Event listener untuk update status perangkat
    socket.on('status-updated', ({ id, status }) => {
        updateButtonStatus(id, status);
    });

    // Event listener untuk data realtime
    socket.on('data-terbaru', ({ perangkat_id, volt, ampere, watt, energy }) => {
        updateDataRealtime(perangkat_id, { volt, ampere, watt, energy });
    });

    // Event listener untuk update limit energi
    socket.on('limit-updated', (data) => {
        updateLimitDisplay(data);
    });

    // Event listener untuk update status pemblokiran
    socket.on('device-blocked', ({ id, blocked }) => {
        updateDeviceBlockStatus(id, blocked);
    });
});

function updateButtonStatus(deviceId, status) {
    const btnOn = document.querySelector(`button[data-device-id="${deviceId}"][data-command="ON"]`);
    const btnOff = document.querySelector(`button[data-device-id="${deviceId}"][data-command="OFF"]`);
    const statusBadge = btnOn?.closest('.card')?.querySelector('.badge');

    if (btnOn && btnOff && statusBadge) {
        // Update tombol ON
        btnOn.classList.toggle('btn-success', status === 'ON');
        btnOn.classList.toggle('btn-outline-success', status !== 'ON');
        
        // Update tombol OFF
        btnOff.classList.toggle('btn-danger', status === 'OFF');
        btnOff.classList.toggle('btn-outline-danger', status !== 'OFF');

        // Update badge status
        statusBadge.className = `badge rounded-pill bg-${status === 'ON' ? 'success' : 'danger'}`;
        statusBadge.innerHTML = `<i class="fas fa-circle me-1"></i>${status}`;
    }
}

function kirimPerintah(id, perintah) {
    const btn = document.querySelector(`button[data-device-id="${id}"][data-command="${perintah}"]`);
    if (!btn) return;

    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Memproses...';
    btn.disabled = true;

    fetch(`/perangkat/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: perintah })
    })
        .then(res => res.json())
        .then(data => {
            if (!data.success) throw new Error(data.message || 'Gagal mengubah status');
            updateButtonStatus(id, perintah);
        })
        .catch(err => {
            console.error('Error:', err);
            alert('Terjadi kesalahan: ' + err.message);
        })
        .finally(() => {
            btn.innerHTML = originalContent;
            btn.disabled = false;
        });
}

function updateDataRealtime(id, { volt, ampere, watt, energy }) {
    const setText = (selector, value, digits = 2) => {
        const el = document.getElementById(`${selector}-${id}`);
        if (el) el.textContent = parseFloat(value).toFixed(digits);
    };

    setText('volt', volt, 1);
    setText('ampere', ampere, 2);
    setText('watt', watt, 1);
    setText('energy', energy, 3);
}

function updateLimitDisplay(limitData) {
    const { totalEnergi, limit, persenLimit } = limitData;
    
    // ✅ Tampilkan container limit
    const limitContainer = document.getElementById('limit-container');
    const statusInfo = document.getElementById('status-info');
    
    if (limitContainer) {
        limitContainer.style.display = 'flex';
        
        // Update periode limit
        const jamMulai = document.getElementById('jam-mulai');
        const jamSelesai = document.getElementById('jam-selesai');
        const totalEnergiEl = document.getElementById('total-energi');
        const batasEnergiEl = document.getElementById('batas-energi');
        const progressBar = document.getElementById('progress-bar');
        
        if (limit && jamMulai && jamSelesai && totalEnergiEl && batasEnergiEl) {
            jamMulai.textContent = new Date(limit.jam_mulai).toLocaleString('id-ID');
            jamSelesai.textContent = new Date(limit.jam_selesai).toLocaleString('id-ID');
            totalEnergiEl.textContent = `${totalEnergi.toFixed(2)} kWh`;
            batasEnergiEl.textContent = `${limit.batas_kwh} kWh`;
        }
        
        // Update progress bar
        if (progressBar) {
            progressBar.style.width = `${persenLimit}%`;
            progressBar.textContent = `${persenLimit}%`;
            
            // Update warna progress bar
            const colorClass = persenLimit < 60 ? 'bg-success' : persenLimit < 80 ? 'bg-warning' : 'bg-danger';
            progressBar.className = `progress-bar ${colorClass}`;
        }
    }
}

function updateDeviceBlockStatus(deviceId, blocked) {
    const card = document.querySelector(`button[data-device-id="${deviceId}"]`)?.closest('.card');
    if (!card) return;

    const btnOn = card.querySelector('button[data-command="ON"]');
    const blockIndicator = card.querySelector('.text-danger');
    const blockAlert = card.querySelector('.alert-danger');

    if (blocked) {
        // Disable tombol ON
        if (btnOn) {
            btnOn.disabled = true;
            btnOn.title = 'Tidak dapat dinyalakan karena limit energi tercapai';
        }

        // Tambahkan indikator pemblokiran jika belum ada
        if (!blockIndicator) {
            const headerDiv = card.querySelector('.card-header div');
            if (headerDiv) {
                const indicator = document.createElement('small');
                indicator.className = 'text-danger';
                indicator.innerHTML = '<br><i class="fas fa-ban"></i> Diblokir oleh limit energi';
                headerDiv.appendChild(indicator);
            }
        }

        // Tambahkan alert pemblokiran jika belum ada
        if (!blockAlert) {
            const cardBody = card.querySelector('.card-body');
            if (cardBody) {
                const alert = document.createElement('div');
                alert.className = 'alert alert-danger p-1 mb-2 text-center';
                alert.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i> Tidak dapat dinyalakan karena limit energi';
                cardBody.insertBefore(alert, cardBody.firstChild);
            }
        }
    } else {
        // Enable tombol ON
        if (btnOn) {
            btnOn.disabled = false;
            btnOn.title = 'Kontrol manual';
        }

        // Hapus indikator pemblokiran
        if (blockIndicator) {
            blockIndicator.remove();
        }

        // Hapus alert pemblokiran
        if (blockAlert) {
            blockAlert.remove();
        }
    }
}
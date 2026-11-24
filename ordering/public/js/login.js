'use strict';

(function initLoginScreen() {
  const passwordInput = document.getElementById('password');
  const toggleBtn = document.getElementById('togglePasswordBtn');
  const staffIdInput = document.getElementById('staffId');
  const deptSelect = document.getElementById('departmentCode');

  if (passwordInput && toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const showing = passwordInput.type === 'text';
      passwordInput.type = showing ? 'password' : 'text';
      toggleBtn.textContent = showing ? '表示' : '非表示';
      toggleBtn.setAttribute('aria-pressed', String(!showing));
    });
  }

  document.querySelectorAll('[data-fill-staff-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (staffIdInput) {
        staffIdInput.value = btn.getAttribute('data-fill-staff-id') || '';
      }
      if (passwordInput) {
        passwordInput.value = 'pass';
      }
      if (deptSelect) {
        deptSelect.value = btn.getAttribute('data-fill-dept') || '';
      }
      if (staffIdInput) {
        staffIdInput.focus();
      }
    });
  });
})();

(function () {
  'use strict';
  const form = document.getElementById('upi-form');
  const qr = document.getElementById('qr');
  const message = document.getElementById('message');
  const open = document.getElementById('open-upi');

  function createIntent(vpa, amount, note) {
    if (!/^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/.test(vpa)) {
      throw new Error('Enter a valid merchant VPA.');
    }
    if (!/^(?:[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/.test(amount)) {
      throw new Error('Enter an amount from 1 to 9999999.99 INR.');
    }
    const values = [
      ['pa', vpa], ['pn', 'Merchant Demo'], ['am', Number(amount).toFixed(2)],
      ['cu', 'INR'], ['tn', note.slice(0, 100)]
    ];
    return 'upi://pay?' + values.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    qr.replaceChildren();
    open.classList.add('hidden');
    try {
      const intent = createIntent(
        document.getElementById('vpa').value.trim(),
        document.getElementById('amount').value.trim(),
        document.getElementById('note').value.trim()
      );
      if (typeof window.QRCode !== 'function') {
        throw new Error('QR library unavailable. Check connectivity or self-host the library.');
      }
      new window.QRCode(qr, { text: intent, width: 188, height: 188, correctLevel: window.QRCode.CorrectLevel.M });
      open.href = intent;
      open.classList.remove('hidden');
      message.textContent = 'Intent created locally. Payment has NOT been verified.';
    } catch (err) {
      message.textContent = err.message;
    }
  });
})();

export function buildUpiIntent({ vpa, amount, note = '', payee = 'Merchant Demo' }) {
  if (!/^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/.test(vpa)) {
    throw new Error('Enter a valid merchant VPA');
  }
  const amountText = String(amount).trim();
  if (!/^(?:[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/.test(amountText)) {
    throw new Error('Enter an amount from 1 to 9999999.99 INR');
  }
  const params = [
    ['pa', vpa], ['pn', payee], ['am', Number(amountText).toFixed(2)],
    ['cu', 'INR'], ['tn', String(note).slice(0, 100)]
  ].map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
  return 'upi://pay?' + params;
}

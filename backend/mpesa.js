/**
 * M-Pesa Daraja API Integration Module
 * 
 * Provides real Safaricom M-Pesa STK Push (Lipa Na M-Pesa Online) integration
 * with automatic fallback to simulation when credentials are not configured.
 * 
 * Sandbox docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 */

const https = require('https');

// Check if real Daraja credentials are configured
function isDarajaConfigured() {
  return !!(
    process.env.MPESA_CONSUMER_KEY &&
    process.env.MPESA_CONSUMER_SECRET &&
    process.env.MPESA_SHORTCODE
  );
}

/**
 * Get OAuth access token from Daraja API
 */
function getOAuthToken() {
  return new Promise((resolve, reject) => {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
    const host = environment === 'production'
      ? 'api.safaricom.co.ke'
      : 'sandbox.safaricom.co.ke';

    const options = {
      hostname: host,
      path: '/oauth/v1/generate?grant_type=client_credentials',
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            resolve(json.access_token);
          } else {
            reject(new Error(`OAuth failed: ${data}`));
          }
        } catch (err) {
          reject(new Error(`OAuth parse error: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('OAuth request timed out'));
    });
    req.end();
  });
}

/**
 * Initiate real STK Push via Daraja API
 * @param {string} phone - Customer phone (e.g. "254712345678")
 * @param {number} amount - Amount in KES
 * @param {string} accountRef - Account reference string
 * @returns {Promise<object>} - Daraja API response
 */
async function initiateSTKPush(phone, amount, accountRef = 'SalesTracker') {
  const token = await getOAuthToken();

  const environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
  const host = environment === 'production'
    ? 'api.safaricom.co.ke'
    : 'sandbox.safaricom.co.ke';

  const shortcode = process.env.MPESA_SHORTCODE || '174379';
  const passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
  const callbackUrl = process.env.MPESA_CALLBACK_URL || 'https://example.com/api/mpesa/callback';

  // Generate timestamp (YYYYMMDDHHmmss)
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  // Generate password: Base64(Shortcode + Passkey + Timestamp)
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  // Normalize phone number to 254 format
  let normalizedPhone = phone.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '254' + normalizedPhone.substring(1);
  } else if (!normalizedPhone.startsWith('254')) {
    normalizedPhone = '254' + normalizedPhone;
  }

  const payload = JSON.stringify({
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amount),
    PartyA: normalizedPhone,
    PartyB: shortcode,
    PhoneNumber: normalizedPhone,
    CallBackURL: callbackUrl,
    AccountReference: accountRef,
    TransactionDesc: `Payment for ${accountRef}`
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      path: '/mpesa/stkpush/v1/processrequest',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error(`STK Push parse error: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('STK Push request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Query STK Push transaction status
 * @param {string} checkoutRequestId - The CheckoutRequestID from STK Push response
 * @returns {Promise<object>}
 */
async function querySTKStatus(checkoutRequestId) {
  const token = await getOAuthToken();

  const environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
  const host = environment === 'production'
    ? 'api.safaricom.co.ke'
    : 'sandbox.safaricom.co.ke';

  const shortcode = process.env.MPESA_SHORTCODE || '174379';
  const passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';

  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const payload = JSON.stringify({
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      path: '/mpesa/stkpushquery/v1/query',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Query parse error: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('STK query request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Generate a simulated M-Pesa code (used when Daraja is not configured)
 */
function generateSimulatedMpesaCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'Q';
  for (let i = 0; i < 9; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Parse the Daraja STK callback body to extract transaction details
 */
function parseSTKCallback(callbackBody) {
  try {
    const stkCallback = callbackBody.Body?.stkCallback;
    if (!stkCallback) return null;

    const result = {
      merchantRequestID: stkCallback.MerchantRequestID,
      checkoutRequestID: stkCallback.CheckoutRequestID,
      resultCode: stkCallback.ResultCode,
      resultDesc: stkCallback.ResultDesc,
      amount: null,
      mpesaReceiptNumber: null,
      transactionDate: null,
      phoneNumber: null
    };

    if (stkCallback.ResultCode === 0 && stkCallback.CallbackMetadata) {
      const items = stkCallback.CallbackMetadata.Item || [];
      items.forEach(item => {
        switch (item.Name) {
          case 'Amount':
            result.amount = item.Value;
            break;
          case 'MpesaReceiptNumber':
            result.mpesaReceiptNumber = item.Value;
            break;
          case 'TransactionDate':
            result.transactionDate = item.Value;
            break;
          case 'PhoneNumber':
            result.phoneNumber = item.Value;
            break;
        }
      });
    }

    return result;
  } catch (err) {
    console.error('Error parsing STK callback:', err);
    return null;
  }
}

module.exports = {
  isDarajaConfigured,
  initiateSTKPush,
  querySTKStatus,
  generateSimulatedMpesaCode,
  parseSTKCallback
};

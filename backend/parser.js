/**
 * Utility to parse M-Pesa SMS confirmation messages.
 * Extract: Transaction Code, Amount, Sender Name, Sender Phone, Date/Time.
 */
function parseMpesaSMS(text) {
  if (!text) return null;
  
  // Normalize whitespace
  const cleanText = text.trim().replace(/\s+/g, ' ');

  // 1. Transaction Code (10 characters alphanumeric, e.g., QGR4PXYZ12)
  const codeRegex = /\b([A-Z0-9]{10})\b/i;
  const codeMatch = cleanText.match(codeRegex);
  if (!codeMatch) return null;
  const code = codeMatch[1].toUpperCase();

  // 2. Amount
  // e.g. "Ksh1,500.00" or "Ksh 1500.00" or "Ksh 1,500.00"
  const amountRegex = /Ksh\s*([\d,]+\.\d{2})/i;
  const amountMatch = cleanText.match(amountRegex);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

  // 3. Date & Time
  // e.g. "on 18/6/26 at 2:34 PM" or "on 18/06/2026 at 2:34 PM"
  const dateTimeRegex = /on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i;
  const dateTimeMatch = cleanText.match(dateTimeRegex);
  let datetime = null;
  if (dateTimeMatch) {
    datetime = `${dateTimeMatch[1]} ${dateTimeMatch[2]}`;
  }

  // 4. Sender Name & Phone (Received)
  let senderName = 'Unknown Sender';
  let senderPhone = '';

  // Pattern A: "received from JOHN DOE (0712345678) on ..." or "received from JOHN DOE 0712345678 on ..."
  const senderRegex1 = /received from\s+([A-Za-z\s0-9]+?)\s*\(?(\d{9,12})\)?\s+on/i;
  
  // Pattern B: "received Ksh1,500.00 from JOHN DOE (0712345678) on ..."
  const senderRegex2 = /received\s+Ksh\s*[\d,\.]+\s+from\s+([A-Za-z\s0-9]+?)\s*\(?(\d{9,12})\)?\s+on/i;
  
  // Pattern C (Merchant notification): "You have received Ksh1,500.00 from JOHN DOE (0712345678) on ..."
  const senderRegex3 = /received\s+Ksh\s*[\d,\.]+\s+from\s+([A-Za-z\s0-9]+?)\s*\(?(\d{9,12})\)?\s+on/i;

  // Pattern D (Paid to Merchant - e.g. customer SMS): "paid to ZAYRE GADGETS on ..."
  const paidToRegex = /paid to\s+([A-Za-z\s0-9_&#]+?)\s+on/i;

  const match1 = cleanText.match(senderRegex1);
  const match2 = cleanText.match(senderRegex2);
  const match3 = cleanText.match(senderRegex3);

  if (match1) {
    senderName = match1[1].trim();
    senderPhone = match1[2].trim();
  } else if (match2) {
    senderName = match2[1].trim();
    senderPhone = match2[2].trim();
  } else if (match3) {
    senderName = match3[1].trim();
    senderPhone = match3[2].trim();
  } else {
    const paidToMatch = cleanText.match(paidToRegex);
    if (paidToMatch) {
      senderName = `Paid to: ${paidToMatch[1].trim()}`;
    }
  }

  // Format sender phone to standard local/international format if parsed
  if (senderPhone) {
    // If it starts with 254, format to 07... / 01... for easier local match
    if (senderPhone.startsWith('254')) {
      senderPhone = '0' + senderPhone.slice(3);
    }
  }

  return {
    code,
    amount,
    senderName,
    senderPhone,
    datetime,
    parsedText: text
  };
}

module.exports = { parseMpesaSMS };

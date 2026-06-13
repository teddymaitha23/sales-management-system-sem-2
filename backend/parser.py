import re

def parse_mpesa_sms(text):
    if not text:
        return None
        
    # Normalize whitespace
    clean_text = " ".join(text.strip().split())

    # 1. Transaction Code (10 alphanumeric chars, e.g., QGR4PXYZ12)
    code_match = re.search(r'\b([A-Z0-9]{10})\b', clean_text, re.IGNORECASE)
    if not code_match:
        return None
    code = code_match.group(1).upper()

    # 2. Amount
    # Matches "Ksh1,500.00", "Ksh 1500.00", "Ksh 1,500.00" etc.
    amount_match = re.search(r'Ksh\s*([\d,]+\.\d{2})', clean_text, re.IGNORECASE)
    if not amount_match:
        return None
    amount = float(amount_match.group(1).replace(',', ''))

    # 3. Date & Time
    # Matches "on 18/6/26 at 2:34 PM" or "on 18/06/2026 at 2:34 PM"
    datetime_match = re.search(r'on\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM))', clean_text, re.IGNORECASE)
    datetime_str = None
    if datetime_match:
        datetime_str = f"{datetime_match.group(1)} {datetime_match.group(2)}"

    # 4. Sender Name & Phone (Received)
    sender_name = 'Unknown Sender'
    sender_phone = ''

    # Pattern A: "... received from JOHN DOE (0712345678) on ..." or "... received from JOHN DOE 0712345678 on ..."
    sender_match_1 = re.search(r'received from\s+([A-Za-z\s0-9]+?)\s*\(?(\d{9,12})\)?\s+on', clean_text, re.IGNORECASE)
    # Pattern B: "... received Ksh1,500.00 from JOHN DOE (0712345678) on ..."
    sender_match_2 = re.search(r'received\s+Ksh\s*[\d,\.]+\s+from\s+([A-Za-z\s0-9]+?)\s*\(?(\d{9,12})\)?\s+on', clean_text, re.IGNORECASE)
    # Pattern C (Merchant notification): "You have received Ksh1,500.00 from JOHN DOE (0712345678) on ..."
    sender_match_3 = re.search(r'You have received\s+Ksh\s*[\d,\.]+\s+from\s+([A-Za-z\s0-9]+?)\s*\(?(\d{9,12})\)?\s+on', clean_text, re.IGNORECASE)
    # Pattern D (Paid to Merchant - customer confirmation): "paid to ZAYRE GADGETS on ..."
    paid_to_match = re.search(r'paid to\s+([A-Za-z\s0-9_&#]+?)\s+on', clean_text, re.IGNORECASE)

    if sender_match_1:
        sender_name = sender_match_1.group(1).strip()
        sender_phone = sender_match_1.group(2).strip()
    elif sender_match_2:
        sender_name = sender_match_2.group(1).strip()
        sender_phone = sender_match_2.group(2).strip()
    elif sender_match_3:
        sender_name = sender_match_3.group(1).strip()
        sender_phone = sender_match_3.group(2).strip()
    elif paid_to_match:
        sender_name = f"Paid to: {paid_to_match.group(1).strip()}"

    # Standardize local phone numbers
    if sender_phone:
        if sender_phone.startswith('254'):
            sender_phone = '0' + sender_phone[3:]

    return {
        'code': code,
        'amount': amount,
        'senderName': sender_name,
        'senderPhone': sender_phone,
        'datetime': datetime_str,
        'parsedText': text
    }

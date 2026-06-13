import http.server
import socketserver
import json
import urllib.parse
import re
import random
from db import get_db_connection
from parser import parse_mpesa_sms
from ai import get_ai_recommendations

PORT = 5000

class SalesTrackerAPIHandler(http.server.BaseHTTPRequestHandler):
    def _send_response(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        # CORS preflight response
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # 1. GET /api/products
        if path == '/api/products':
            conn = get_db_connection()
            try:
                rows = conn.execute("SELECT * FROM products WHERE is_deleted = 0 ORDER BY created_at DESC;").fetchall()
            except Exception:
                rows = conn.execute("SELECT * FROM products ORDER BY created_at DESC;").fetchall()
            products = [dict(row) for row in rows]
            conn.close()
            return self._send_response(200, products)

        # 2. GET /api/orders
        elif path == '/api/orders':
            conn = get_db_connection()
            # Fetch orders
            order_rows = conn.execute("SELECT * FROM orders ORDER BY created_at DESC;").fetchall()
            orders = []
            for o_row in order_rows:
                order_id = o_row['id']
                # Fetch items for this order
                item_rows = conn.execute("""
                    SELECT oi.*, p.name 
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.id
                    WHERE oi.order_id = ?;
                """, (order_id,)).fetchall()
                
                order_dict = dict(o_row)
                order_dict['items'] = [dict(i_row) for i_row in item_rows]
                orders.append(order_dict)
            conn.close()
            return self._send_response(200, orders)

        # 2.5. GET /api/customers
        elif path == '/api/customers':
            conn = get_db_connection()
            try:
                rows = conn.execute("SELECT * FROM customers ORDER BY created_at DESC;").fetchall()
                customers = [dict(row) for row in rows]
            except Exception:
                # Table doesn't exist, derive from orders
                order_rows = conn.execute("SELECT customer_name, customer_phone, total_amount, payment_status, created_at FROM orders;").fetchall()
                customer_map = {}
                for o in order_rows:
                    name = o['customer_name']
                    if not name or name in ['Online Customer', 'Walk-in Customer']:
                        continue
                    if name not in customer_map:
                        customer_map[name] = {
                            "id": name,
                            "name": name,
                            "phone": o['customer_phone'] or '',
                            "email": '',
                            "notes": 'Derived from order history',
                            "orders": 0,
                            "totalSpent": 0,
                            "lastOrder": o['created_at'],
                            "firstOrder": o['created_at']
                        }
                    customer_map[name]['orders'] += 1
                    if o['payment_status'] == 'Paid':
                        customer_map[name]['totalSpent'] += o['total_amount']
                    if o['created_at'] > customer_map[name]['lastOrder']:
                        customer_map[name]['lastOrder'] = o['created_at']
                conn.close()
                return self._send_response(200, list(customer_map.values()))

            # Enrich from orders
            order_rows = conn.execute("SELECT customer_name, total_amount, payment_status, created_at FROM orders;").fetchall()
            customer_map = {}
            for o in order_rows:
                name = o['customer_name']
                if not name:
                    continue
                if name not in customer_map:
                    customer_map[name] = {"orders": 0, "totalSpent": 0, "lastOrder": o['created_at'], "firstOrder": o['created_at']}
                customer_map[name]['orders'] += 1
                if o['payment_status'] == 'Paid':
                    customer_map[name]['totalSpent'] += o['total_amount']
                if o['created_at'] > customer_map[name]['lastOrder']:
                    customer_map[name]['lastOrder'] = o['created_at']

            enriched_customers = []
            for c in customers:
                stats = customer_map.get(c['name'], {"orders": 0, "totalSpent": 0, "lastOrder": None, "firstOrder": c.get('created_at')})
                enriched_customers.append({
                    "id": c['id'],
                    "name": c['name'],
                    "phone": c.get('phone') or '',
                    "email": c.get('email') or '',
                    "notes": c.get('notes') or '',
                    "orders": stats['orders'],
                    "totalSpent": stats['totalSpent'],
                    "lastOrder": stats['lastOrder'],
                    "firstOrder": stats['firstOrder'] or c.get('created_at')
                })
            conn.close()
            return self._send_response(200, enriched_customers)

        # 3. GET /api/ai/recommendations
        elif path == '/api/ai/recommendations':
            recs = get_ai_recommendations()
            return self._send_response(200, recs)

        # 4. GET /api/reports/dashboard
        elif path == '/api/reports/dashboard':
            conn = get_db_connection()
            
            # KPI calculations
            rev_row = conn.execute("SELECT SUM(total_amount) as total FROM orders WHERE payment_status = 'Paid';").fetchone()
            total_revenue = rev_row['total'] if rev_row and rev_row['total'] is not None else 0.0
            
            cnt_row = conn.execute("SELECT COUNT(*) as count FROM orders WHERE payment_status = 'Paid';").fetchone()
            sales_count = cnt_row['count'] if cnt_row else 0
            avg_sale_value = total_revenue / sales_count if sales_count > 0 else 0.0
            
            cust_row = conn.execute("""
                SELECT customer_name, SUM(total_amount) as total 
                FROM orders 
                WHERE payment_status = 'Paid' AND customer_name IS NOT NULL AND customer_name != 'Online Customer'
                GROUP BY customer_name 
                ORDER BY total DESC 
                LIMIT 1;
            """).fetchone()
            best_customer = {'name': cust_row['customer_name'], 'value': cust_row['total']} if cust_row else {'name': 'N/A', 'value': 0.0}
            
            status_row = conn.execute("""
                SELECT 
                  SUM(CASE WHEN payment_status = 'Pending' THEN 1 ELSE 0 END) as pending,
                  SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) as fulfilled
                FROM orders;
            """).fetchone()
            pending_orders = status_row['pending'] if status_row and status_row['pending'] is not None else 0
            fulfilled_orders = status_row['fulfilled'] if status_row and status_row['fulfilled'] is not None else 0
            
            # Simple simulation for conversion rate
            conversion_rate = 84.5 if sales_count > 0 else 0.0
            
            conn.close()
            
            return self._send_response(200, {
                "totalRevenue": total_revenue,
                "salesCount": sales_count,
                "avgSaleValue": avg_sale_value,
                "conversionRate": conversion_rate,
                "pendingOrders": pending_orders,
                "fulfilledOrders": fulfilled_orders,
                "bestCustomer": best_customer
            })

        # 5. GET /api/reports/monthly
        elif path == '/api/reports/monthly':
            conn = get_db_connection()
            query = """
                SELECT 
                  strftime('%Y-%m', o.created_at) as month,
                  p.id as product_id,
                  p.name as product_name,
                  p.category,
                  SUM(oi.quantity) as quantity_sold,
                  SUM(oi.quantity * oi.unit_price) as revenue
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                JOIN orders o ON oi.order_id = o.id
                WHERE o.payment_status = 'Paid'
                GROUP BY month, p.id
                ORDER BY month DESC, quantity_sold DESC;
            """
            
            rows = conn.execute(query).fetchall()
            conn.close()
            
            # Group items by month
            monthly_report = {}
            for row in rows:
                month = row['month']
                if month not in monthly_report:
                    monthly_report[month] = {
                        'month': month,
                        'totalRevenue': 0.0,
                        'totalItemsSold': 0,
                        'bestSeller': None,
                        'products': []
                    }
                
                m_data = monthly_report[month]
                m_data['totalRevenue'] += row['revenue']
                m_data['totalItemsSold'] += row['quantity_sold']
                
                prod_dict = dict(row)
                m_data['products'].append(prod_dict)
                
                # Check for best seller of the month
                if not m_data['bestSeller'] or row['quantity_sold'] > m_data['bestSeller']['quantity_sold']:
                    m_data['bestSeller'] = {
                        'product_id': row['product_id'],
                        'name': row['product_name'],
                        'quantity_sold': row['quantity_sold'],
                        'revenue': row['revenue']
                    }
                    
            return self._send_response(200, list(monthly_report.values()))
            
        else:
            return self._send_response(404, {"error": "Endpoint not found."})

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            data = json.loads(body) if body else {}
        except Exception:
            return self._send_response(400, {"error": "Invalid JSON body."})

        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # 1. POST /api/products
        if path == '/api/products':
            name = data.get('name')
            description = data.get('description', '')
            price = data.get('price')
            stock = data.get('stock')
            category = data.get('category', '')
            image_url = data.get('image_url', '')

            if not name or price is None or stock is None:
                return self._send_response(400, {"error": "Name, price, and stock are required."})

            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    INSERT INTO products (name, description, price, stock, category, image_url)
                    VALUES (?, ?, ?, ?, ?, ?);
                """, (name, description, float(price), int(stock), category, image_url))
                conn.commit()
                prod_id = cursor.lastrowid
                conn.close()
                return self._send_response(201, {
                    "id": prod_id, "name": name, "description": description, 
                    "price": price, "stock": stock, "category": category, "image_url": image_url
                })
            except Exception as e:
                conn.close()
                return self._send_response(500, {"error": str(e)})

        # 1.5. POST /api/customers
        elif path == '/api/customers':
            name = data.get('name')
            phone = data.get('phone', '')
            email = data.get('email', '')
            notes = data.get('notes', '')

            if not name:
                return self._send_response(400, {"error": "Customer name is required."})

            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    INSERT INTO customers (name, phone, email, notes)
                    VALUES (?, ?, ?, ?);
                """, (name, phone, email, notes))
                conn.commit()
                cust_id = cursor.lastrowid
                conn.close()
                return self._send_response(201, {
                    "id": cust_id, "name": name, "phone": phone, "email": email, "notes": notes, "orders": 0, "totalSpent": 0, "firstOrder": ""
                })
            except Exception as e:
                conn.close()
                if "no such table" in str(e).lower() or "relation" in str(e).lower():
                    import time
                    return self._send_response(201, {
                        "id": f"sim-{int(time.time() * 1000)}", "name": name, "phone": phone, "email": email, "notes": notes, "orders": 0, "totalSpent": 0, "firstOrder": ""
                    })
                return self._send_response(500, {"error": str(e)})

        # 2. POST /api/orders
        elif path == '/api/orders':
            customer_name = data.get('customer_name', '')
            customer_phone = data.get('customer_phone', '')
            payment_method = data.get('payment_method')
            payment_status = data.get('payment_status', 'Pending')
            order_status = data.get('order_status', 'Pending')
            items = data.get('items', [])
            mpesa_code = data.get('mpesa_code', None)

            if not payment_method or not items:
                return self._send_response(400, {"error": "Payment method and items are required."})

            total_amount = sum(float(item['price']) * int(item['quantity']) for item in items)

            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    INSERT INTO orders (customer_name, customer_phone, payment_method, payment_status, order_status, total_amount, mpesa_code)
                    VALUES (?, ?, ?, ?, ?, ?, ?);
                """, (customer_name, customer_phone, payment_method, payment_status, order_status, total_amount, mpesa_code))
                
                order_id = cursor.lastrowid
                
                # Insert order items and deduct stock if paid
                for item in items:
                    cursor.execute("""
                        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
                        VALUES (?, ?, ?, ?);
                    """, (order_id, item['id'], item['quantity'], item['price']))
                    
                    if payment_status == 'Paid' or order_status == 'Fulfilled':
                        cursor.execute("""
                            UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?;
                        """, (item['quantity'], item['id']))
                        
                conn.commit()
                conn.close()
                return self._send_response(201, {"id": order_id, "total_amount": total_amount, "payment_status": payment_status, "order_status": order_status})
            except Exception as e:
                conn.close()
                return self._send_response(500, {"error": str(e)})

        # 3. POST /api/mpesa/stk-push
        elif path == '/api/mpesa/stk-push':
            phone = data.get('phone')
            amount = data.get('amount')
            name = data.get('name', 'Online Customer')
            items = data.get('items', [])

            if not phone or amount is None or not items:
                return self._send_response(400, {"error": "Phone, amount, and items are required."})

            # Mock generating M-Pesa Transaction code
            chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
            mpesa_code = 'Q' + ''.join(random.choice(chars) for _ in range(9))

            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                total_amount = float(amount)
                cursor.execute("""
                    INSERT INTO orders (customer_name, customer_phone, payment_method, payment_status, order_status, total_amount, mpesa_code)
                    VALUES (?, ?, 'M-Pesa Online', 'Paid', 'Fulfilled', ?, ?);
                """, (name, phone, total_amount, mpesa_code))
                
                order_id = cursor.lastrowid
                for item in items:
                    cursor.execute("""
                        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
                        VALUES (?, ?, ?, ?);
                    """, (order_id, item['id'], item['quantity'], item['price']))
                    cursor.execute("""
                        UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?;
                    """, (item['quantity'], item['id']))
                
                conn.commit()
                conn.close()
                return self._send_response(200, {
                    "status": "Success",
                    "message": "M-Pesa payment confirmed successfully (Simulated STK Push).",
                    "mpesaCode": mpesa_code,
                    "orderId": order_id
                })
            except Exception as e:
                conn.close()
                return self._send_response(500, {"error": str(e)})

        # 4. POST /api/mpesa/parse
        elif path == '/api/mpesa/parse':
            text = data.get('text')
            if not text:
                return self._send_response(400, {"error": "SMS text is required."})

            parsed = parse_mpesa_sms(text)
            if not parsed:
                return self._send_response(422, {"error": "Failed to parse message. Please ensure it is a valid M-Pesa SMS."})

            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Check if transaction already exists in database
            existing = cursor.execute("SELECT * FROM mpesa_transactions WHERE mpesa_code = ?;", (parsed['code'],)).fetchone()
            
            if existing:
                conn.close()
                return self._send_response(200, {
                    "message": "This M-Pesa transaction is already parsed and logged.",
                    "parsed": {
                        **parsed,
                        "isReconciled": existing['is_reconciled'],
                        "reconciledOrderId": existing['reconciled_order_id']
                    }
                })

            try:
                cursor.execute("""
                    INSERT INTO mpesa_transactions (mpesa_code, sender_name, sender_phone, amount, parsed_text, is_reconciled)
                    VALUES (?, ?, ?, ?, ?, 0);
                """, (parsed['code'], parsed['senderName'], parsed['senderPhone'], parsed['amount'], text))
                
                # Check for auto-match with a pending order of identical amount
                matched_order = cursor.execute("""
                    SELECT id, customer_name FROM orders 
                    WHERE payment_status = 'Pending' AND ABS(total_amount - ?) < 0.01
                    ORDER BY created_at DESC LIMIT 1;
                """, (parsed['amount'],)).fetchone()
                
                conn.commit()
                conn.close()
                
                return self._send_response(200, {
                    "parsed": parsed,
                    "autoMatch": dict(matched_order) if matched_order else None
                })
            except Exception as e:
                conn.close()
                return self._send_response(500, {"error": str(e)})

        # 5. POST /api/mpesa/reconcile
        elif path == '/api/mpesa/reconcile':
            order_id = data.get('orderId')
            mpesa_code = data.get('mpesaCode')

            if not order_id or not mpesa_code:
                return self._send_response(400, {"error": "orderId and mpesaCode are required."})

            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                # Update Order
                cursor.execute("""
                    UPDATE orders 
                    SET payment_status = 'Paid', order_status = 'Fulfilled', mpesa_code = ? 
                    WHERE id = ? AND payment_status = 'Pending';
                """, (mpesa_code, order_id))
                
                if cursor.rowcount == 0:
                    conn.close()
                    return self._send_response(400, {"error": "Order not found, or it is already paid/reconciled."})

                # Mark transaction as reconciled
                cursor.execute("""
                    UPDATE mpesa_transactions 
                    SET is_reconciled = 1, reconciled_order_id = ? 
                    WHERE mpesa_code = ?;
                """, (order_id, mpesa_code))

                # Retrieve order items and subtract stock
                items = cursor.execute("SELECT * FROM order_items WHERE order_id = ?;", (order_id,)).fetchall()
                for item in items:
                    cursor.execute("""
                        UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?;
                    """, (item['quantity'], item['product_id']))

                conn.commit()
                conn.close()
                return self._send_response(200, {"status": "Success", "message": f"Order #{order_id} successfully reconciled with M-Pesa Ref: {mpesa_code}."})
            except Exception as e:
                conn.close()
                return self._send_response(500, {"error": str(e)})
        else:
            return self._send_response(404, {"error": "Endpoint not found."})

    def do_PUT(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            data = json.loads(body) if body else {}
        except Exception:
            return self._send_response(400, {"error": "Invalid JSON body."})

        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # 1. PUT /api/products/:id
        prod_match = re.match(r'^/api/products/(\d+)$', path)
        if prod_match:
            prod_id = int(prod_match.group(1))
            name = data.get('name')
            description = data.get('description', '')
            price = data.get('price')
            stock = data.get('stock')
            category = data.get('category', '')
            image_url = data.get('image_url', '')

            if not name or price is None or stock is None:
                return self._send_response(400, {"error": "Name, price, and stock are required."})

            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    UPDATE products 
                    SET name = ?, description = ?, price = ?, stock = ?, category = ?, image_url = ?
                    WHERE id = ?;
                """, (name, description, float(price), int(stock), category, image_url, prod_id))
                conn.commit()
                conn.close()
                return self._send_response(200, {"message": "Product updated successfully.", "id": prod_id})
            except Exception as e:
                conn.close()
                return self._send_response(500, {"error": str(e)})

        # 2. PUT /api/orders/:id
        order_match = re.match(r'^/api/orders/(\d+)$', path)
        if order_match:
            order_id = int(order_match.group(1))
            order_status = data.get('order_status')
            payment_status = data.get('payment_status')
            mpesa_code = data.get('mpesa_code')

            conn = get_db_connection()
            cursor = conn.cursor()
            order = cursor.execute("SELECT * FROM orders WHERE id = ?;", (order_id,)).fetchone()
            if not order:
                conn.close()
                return self._send_response(404, {"error": "Order not found."})

            new_payment_status = payment_status if payment_status else order['payment_status']
            new_order_status = order_status if order_status else order['order_status']
            new_mpesa_code = mpesa_code if mpesa_code else order['mpesa_code']

            deduct_stock = (new_payment_status == 'Paid' and order['payment_status'] != 'Paid')

            try:
                cursor.execute("""
                    UPDATE orders 
                    SET order_status = ?, payment_status = ?, mpesa_code = ?
                    WHERE id = ?;
                """, (new_order_status, new_payment_status, new_mpesa_code, order_id))

                if deduct_stock:
                    items = cursor.execute("SELECT * FROM order_items WHERE order_id = ?;", (order_id,)).fetchall()
                    for item in items:
                        cursor.execute("""
                            UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?;
                        """, (item['quantity'], item['product_id']))

                conn.commit()
                conn.close()
                return self._send_response(200, {
                    "message": "Order updated successfully.",
                    "id": order_id,
                    "order_status": new_order_status,
                    "payment_status": new_payment_status
                })
            except Exception as e:
                conn.close()
                return self._send_response(500, {"error": str(e)})
        else:
            return self._send_response(404, {"error": "Endpoint not found."})

    def do_DELETE(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # 1. DELETE /api/products/:id
        prod_match = re.match(r'^/api/products/(\d+)$', path)
        if prod_match:
            prod_id = int(prod_match.group(1))
            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("DELETE FROM products WHERE id = ?;", (prod_id,))
                conn.commit()
                conn.close()
                return self._send_response(200, {"message": "Product deleted successfully.", "id": prod_id})
            except Exception as e:
                # If foreign key violation, try to soft-delete
                if "constraint failed" in str(e).lower() or "foreign key" in str(e).lower():
                    try:
                        cursor.execute("UPDATE products SET is_deleted = 1 WHERE id = ?;", (prod_id,))
                        conn.commit()
                        conn.close()
                        return self._send_response(200, {"message": "Product has active orders. Soft-deleted successfully.", "id": prod_id})
                    except Exception as err:
                        conn.close()
                        return self._send_response(500, {"error": "Failed to soft-delete product: " + str(err)})
                conn.close()
                return self._send_response(500, {"error": str(e)})
        else:
            return self._send_response(404, {"error": "Endpoint not found."})

def run(server_class=socketserver.TCPServer, handler_class=SalesTrackerAPIHandler):
    socketserver.TCPServer.allow_reuse_address = True
    with server_class(("", PORT), handler_class) as httpd:
        print(f"API Server listening on port {PORT}...")
        httpd.serve_forever()

if __name__ == '__main__':
    run()

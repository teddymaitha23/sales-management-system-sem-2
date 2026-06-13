import os
import json
import urllib.request
from db import get_db_connection

def generate_ai_text(analysis_report):
    summary = "🤖 **AI Inventory Assistant Report**\n\n"
    
    critical = [a for a in analysis_report if a['priority'] == 1]
    warning = [a for a in analysis_report if a['priority'] == 2]

    if critical:
        summary += f"⚠️ **CRITICAL RESTOCK ACTIONS REQUIRED ({len(critical)})**:\n"
        for c in critical:
            summary += f"- **{c['name']}** ({c['status']}): Currently **{c['stock']}** in stock. {c['recommendation']}\n"
        summary += "\n"

    if warning:
        summary += f"📊 **LOW STOCK WARNINGS ({len(warning)})**:\n"
        for w in warning:
            summary += f"- **{w['name']}**: **{w['stock']}** units remaining. {w['recommendation']}\n"
        summary += "\n"

    summary += "📈 **General Inventory Insight**:\n"
    if not critical and not warning:
        summary += "All stock levels are currently healthy! Continue tracking daily transactions.\n"
    else:
        summary += "Focus replenishment efforts on the critical high-priority items listed above to avoid missing sales opportunities. "
        overstocked = [a for a in analysis_report if a['status'] == 'Overstocked']
        if overstocked:
            summary += f"Additionally, you have {len(overstocked)} overstocked item(s) where capital is locked."

    return summary

def call_gemini_api(analysis_report, api_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    payload = {
        "contents": [{
            "parts": [{
                "text": (
                    "You are an expert SME retail business consultant in Nairobi, Kenya. "
                    "Analyze the following inventory data and give highly detailed, professional "
                    "restocking advice and sales suggestions for the business owner. Keep it "
                    "practical, actionable, and refer to M-Pesa transactions/local Nairobi retail patterns if helpful.\n\n"
                    f"Inventory Data:\n{json.dumps(analysis_report, indent=2)}"
                )
            }]
        }]
    }
    
    req_data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=req_data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            res_data = response.read().decode('utf-8')
            res_json = json.loads(res_data)
            return res_json['candidates'][0]['content']['parts'][0]['text']
    except Exception as e:
        print(f"Gemini API request failed: {e}")
        return None

def get_ai_recommendations():
    conn = get_db_connection()
    query = """
        SELECT 
          p.id, 
          p.name, 
          p.stock, 
          p.price, 
          p.category,
          oi.quantity,
          o.created_at as order_date
        FROM products p
        LEFT JOIN order_items oi ON p.id = oi.product_id
        LEFT JOIN orders o ON oi.order_id = o.id AND o.payment_status = 'Paid'
    """
    
    try:
        rows = conn.execute(query).fetchall()
    except Exception as e:
        conn.close()
        return {"error": str(e)}
        
    conn.close()

    # Aggregate stats
    products = {}
    for row in rows:
        p_id = row['id']
        if p_id not in products:
            products[p_id] = {
                'id': p_id,
                'name': row['name'],
                'stock': row['stock'],
                'price': row['price'],
                'category': row['category'],
                'totalSold': 0,
                'monthlySales': {}
            }
            
        qty = row['quantity']
        order_date = row['order_date']
        
        if qty is not None and order_date is not None:
            qty_int = int(qty)
            products[p_id]['totalSold'] += qty_int
            
            # Group by "YYYY-MM"
            date_str = order_date[:7]
            products[p_id]['monthlySales'][date_str] = products[p_id]['monthlySales'].get(date_str, 0) + qty_int

    products_list = list(products.values())
    analysis_report = []

    for prod in products_list:
        months_sold = list(prod['monthlySales'].keys())
        total_months = max(len(months_sold), 1)
        avg_monthly_sales = int(prod['totalSold'] / total_months)
        
        stock_velocity_days = 999
        if avg_monthly_sales > 0:
            daily_rate = avg_monthly_sales / 30.0
            stock_velocity_days = int(prod['stock'] / daily_rate)
        elif prod['stock'] == 0:
            stock_velocity_days = 0

        status = 'Healthy'
        recommendation = 'No action required. Monitor stock levels periodically.'
        priority = 3 # 1=Critical, 2=Warning, 3=Normal

        if prod['stock'] == 0:
            status = 'Out of Stock'
            recommendation = f"Restock immediately! You have 0 units in stock. Recommend ordering a minimum of {max(int(avg_monthly_sales * 1.5), 10)} units based on historical demand."
            priority = 1
        elif stock_velocity_days <= 10:
            status = 'Critical Stock'
            recommendation = f"Stock will run out in approx. {stock_velocity_days} days. Average sales: {avg_monthly_sales} units/month. Recommend restocking {max(avg_monthly_sales - prod['stock'], 5)} units."
            priority = 1
        elif stock_velocity_days <= 30:
            status = 'Low Stock'
            recommendation = f"Stock is sufficient for {stock_velocity_days} days. Consider scheduling a restock order of {max(int(avg_monthly_sales * 0.8), 5)} units within the next two weeks."
            priority = 2
        elif avg_monthly_sales > 0 and prod['stock'] > avg_monthly_sales * 3:
            status = 'Overstocked'
            recommendation = f"Current stock ({prod['stock']} units) exceeds 3 months of average sales. Avoid restocking. Recommend setting up a discount campaign to free up capital."
            priority = 3

        analysis_report.append({
            'id': prod['id'],
            'name': prod['name'],
            'category': prod['category'],
            'stock': prod['stock'],
            'avgMonthlySales': avg_monthly_sales,
            'stockVelocityDays': stock_velocity_days,
            'status': status,
            'recommendation': recommendation,
            'priority': priority
        })

    # Sort reports by priority and stock velocity
    analysis_report.sort(key=lambda x: (x['priority'], x['stockVelocityDays']))

    gemini_key = os.environ.get('GEMINI_API_KEY')
    ai_text = None
    if gemini_key:
        ai_text = call_gemini_api(analysis_report, gemini_key)

    if not ai_text:
        ai_text = generate_ai_text(analysis_report)

    return {
        "summary": ai_text,
        "detailedAnalysis": analysis_report
    }

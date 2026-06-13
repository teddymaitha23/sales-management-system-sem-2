-- Run this in the Supabase SQL editor to allow the Node.js backend to read and write data
-- Note: This creates public access policies. Since you have an Express backend protecting the DB, this is acceptable for now.

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for anon" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon" ON mpesa_transactions FOR ALL USING (true) WITH CHECK (true);

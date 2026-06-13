-- Multi-Tenant Auth Migration Script
-- Run this in your Supabase SQL Editor

-- 1. Wipe existing dummy data to avoid constraint errors
TRUNCATE TABLE mpesa_transactions CASCADE;
TRUNCATE TABLE order_items CASCADE;
TRUNCATE TABLE orders CASCADE;
TRUNCATE TABLE products CASCADE;

-- 2. Add user_id column to tables
ALTER TABLE products ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid();
ALTER TABLE orders ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid();
ALTER TABLE mpesa_transactions ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();

-- 3. Update Row Level Security (RLS) Policies
-- Drop the old permissive policies
DROP POLICY IF EXISTS "Allow all operations for anon" ON products;
DROP POLICY IF EXISTS "Allow all operations for anon" ON orders;
DROP POLICY IF EXISTS "Allow all operations for anon" ON order_items;
DROP POLICY IF EXISTS "Allow all operations for anon" ON mpesa_transactions;

-- Create new strict multi-tenant policies
-- Products
CREATE POLICY "Users can only see and manage their own products" 
ON products FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Orders
CREATE POLICY "Users can only see and manage their own orders" 
ON orders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Order Items (Derived from Order's user_id implicitly through the app, but for strict DB RLS we join or just allow if order is owned)
-- Since we didn't add user_id to order_items to avoid redundancy, we check the parent order
CREATE POLICY "Users can manage order items of their orders" 
ON order_items FOR ALL 
USING (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
);

-- M-Pesa Transactions
CREATE POLICY "Users can manage their own mpesa transactions" 
ON mpesa_transactions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

const db = require('./db');

const sampleProducts = [
  { name: 'Redmi Note 13', description: '8GB RAM, 256GB Storage, 108MP Camera', price: 24500, stock: 12, category: 'Smartphones', image_url: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=300' },
  { name: 'Samsung Galaxy A15', description: '4GB RAM, 128GB Storage, LTE', price: 18500, stock: 5, category: 'Smartphones', image_url: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=300' },
  { name: 'Oraimo FreePods 4', description: 'Active Noise Cancelling True Wireless Earbuds', price: 4500, stock: 25, category: 'Audio', image_url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=300' },
  { name: 'Anker PowerCore 20k', description: '20000mAh Power Bank with 20W Power Delivery', price: 5500, stock: 0, category: 'Accessories', image_url: 'https://images.unsplash.com/photo-1609592424085-78e794967395?w=300' },
  { name: 'Vitron 32 inch Smart TV', description: 'Frameless Android Smart LED TV', price: 13500, stock: 3, category: 'Electronics', image_url: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?w=300' },
  { name: 'Type-C Fast Charger 20W', description: 'Dual port wall adapter with cable', price: 1500, stock: 45, category: 'Accessories', image_url: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=300' }
];

function getPastDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString(); // Postgres timestamp tz format
}

async function seed() {
  console.log('Seeding Supabase database...');
  
  // Clear existing data (Order matters because of foreign keys)
  await db.from('order_items').delete().neq('id', 0);
  await db.from('mpesa_transactions').delete().neq('id', 0);
  await db.from('orders').delete().neq('id', 0);
  await db.from('products').delete().neq('id', 0);

  // 1. Insert Products
  const { data: insertedProducts, error: prodErr } = await db.from('products').insert(sampleProducts).select();
  
  if (prodErr) {
    console.error('Error inserting products:', prodErr);
    return;
  }
  
  console.log(`Inserted ${insertedProducts.length} products.`);

  // 2. Seed Sales History
  console.log('Seeding sales history...');
  
  const mpesaCodes = ['QHN1A7X92J', 'QIP3M8Y20K', 'QKB4P9D81L', 'QLA9Z2X74M', 'QNB5R1T63V'];
  const customers = [
    { name: 'Teddy Maitha', phone: '0712345678' },
    { name: 'Alice Wambui', phone: '0722112233' },
    { name: 'John Kamau', phone: '0733445566' },
    { name: 'Sarah Atieno', phone: '0799887766' }
  ];

  const numOrders = 25;
  const newOrders = [];
  const orderItemsBatches = [];

  for (let i = 0; i < numOrders; i++) {
    const daysAgo = Math.floor(Math.random() * 85);
    const orderDate = getPastDate(daysAgo);
    
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const paymentMethod = Math.random() > 0.4 ? 'M-Pesa Online' : (Math.random() > 0.5 ? 'Cash' : 'M-Pesa SMS');
    const paymentStatus = paymentMethod === 'M-Pesa SMS' && Math.random() > 0.6 ? 'Pending' : 'Paid';
    const orderStatus = paymentStatus === 'Paid' ? 'Fulfilled' : 'Pending';
    const mpesaCode = paymentMethod !== 'Cash' && paymentStatus === 'Paid' ? 
                      (mpesaCodes.pop() || 'Q' + Math.random().toString(36).substring(2, 11).toUpperCase()) : null;

    const numItems = Math.floor(Math.random() * 2) + 1;
    const selectedItems = [];
    let totalAmount = 0;

    for (let j = 0; j < numItems; j++) {
      const prod = insertedProducts[Math.floor(Math.random() * insertedProducts.length)];
      if (!selectedItems.find(item => item.id === prod.id)) {
        const qty = Math.floor(Math.random() * 2) + 1;
        selectedItems.push({ id: prod.id, price: prod.price, qty });
        totalAmount += prod.price * qty;
      }
    }

    // Prepare order data
    const orderData = {
      customer_name: customer.name,
      customer_phone: customer.phone,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      order_status: orderStatus,
      total_amount: totalAmount,
      mpesa_code: mpesaCode,
      created_at: orderDate
    };

    // Insert order and get ID
    const { data: savedOrder, error: orderErr } = await db.from('orders').insert([orderData]).select().single();
    
    if (orderErr) {
      console.error('Error inserting order:', orderErr);
      continue;
    }

    // Build order items
    selectedItems.forEach(item => {
      orderItemsBatches.push({
        order_id: savedOrder.id,
        product_id: item.id,
        quantity: item.qty,
        unit_price: item.price
      });
    });
  }

  // Insert all items
  if (orderItemsBatches.length > 0) {
    const { error: itemsErr } = await db.from('order_items').insert(orderItemsBatches);
    if (itemsErr) console.error('Error inserting order items:', itemsErr);
  }

  console.log('Database seeding completed successfully!');
  process.exit(0);
}

seed();

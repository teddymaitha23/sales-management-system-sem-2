const db = require('./db');

function getMonthName(monthNumber) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[monthNumber - 1] || 'Unknown';
}

/**
 * Check if Gemini API is configured
 */
function isGeminiConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Perform analysis of sales velocity and current inventory.
 * If process.env.GEMINI_API_KEY is defined, call Gemini for recommendations.
 * Otherwise, compile a detailed rule-based analytical report.
 */
function getAIRecommendations(callback) {
  // Query Supabase: get all products, and their related order items (only if the order was Paid)
  db.from('products')
    .select(`
      id, name, stock, price, category,
      order_items (
        quantity,
        orders (
          payment_status,
          created_at
        )
      )
    `)
    .then(({ data: productsData, error }) => {
      if (error) {
        return callback(error, null);
      }

      // Process rows to aggregate product statistics
      const productsList = productsData.map(prod => {
        const pObj = {
          id: prod.id,
          name: prod.name,
          stock: prod.stock,
          price: prod.price,
          category: prod.category,
          totalSold: 0,
          monthlySales: {}, // e.g. { '2026-06': 15 }
          salesHistory: []
        };

        if (prod.order_items && prod.order_items.length > 0) {
          prod.order_items.forEach(oi => {
            // Check if there is an associated order and if it was Paid
            if (oi.orders && oi.orders.payment_status === 'Paid') {
              const qty = oi.quantity || 0;
              pObj.totalSold += qty;
              
              const dateStr = oi.orders.created_at ? oi.orders.created_at.substring(0, 7) : null;
              if (dateStr) {
                pObj.monthlySales[dateStr] = (pObj.monthlySales[dateStr] || 0) + qty;
              }
            }
          });
        }
        return pObj;
      });

      // Perform heuristic analysis
      const analysisReport = productsList.map(prod => {
        const months = Object.keys(prod.monthlySales);
        const totalMonths = Math.max(months.length, 1);
        const avgMonthlySales = Math.ceil(prod.totalSold / totalMonths) || 0;
        
        let stockVelocityDays = 999;
        if (avgMonthlySales > 0) {
          const dailyRate = avgMonthlySales / 30;
          stockVelocityDays = Math.ceil(prod.stock / dailyRate);
        } else if (prod.stock === 0) {
          stockVelocityDays = 0;
        }

        let status = 'Healthy';
        let recommendation = 'No action required. Monitor stock levels periodically.';
        let priority = 3; 

        if (prod.stock === 0) {
          status = 'Out of Stock';
          recommendation = `Restock immediately! You have 0 units in stock. Recommend ordering a minimum of ${Math.max(avgMonthlySales * 1.5, 10)} units based on historical demand.`;
          priority = 1;
        } else if (stockVelocityDays <= 10) {
          status = 'Critical Stock';
          recommendation = `Stock will run out in approx. ${stockVelocityDays} days. Average sales: ${avgMonthlySales} units/month. Recommend restocking ${Math.max(avgMonthlySales - prod.stock, 5)} units.`;
          priority = 1;
        } else if (stockVelocityDays <= 30) {
          status = 'Low Stock';
          recommendation = `Stock is sufficient for ${stockVelocityDays} days. Consider scheduling a restock order of ${Math.max(Math.ceil(avgMonthlySales * 0.8), 5)} units within the next two weeks.`;
          priority = 2;
        } else if (prod.stock > avgMonthlySales * 3 && avgMonthlySales > 0) {
          status = 'Overstocked';
          recommendation = `Current stock (${prod.stock} units) exceeds 3 months of average sales. Avoid restocking. Recommend setting up a discount campaign to free up capital.`;
          priority = 3;
        }

        return {
          id: prod.id,
          name: prod.name,
          category: prod.category,
          stock: prod.stock,
          avgMonthlySales,
          stockVelocityDays,
          status,
          recommendation,
          priority
        };
      });

      // Order reports by priority (1 first) and stock velocity
      analysisReport.sort((a, b) => a.priority - b.priority || a.stockVelocityDays - b.stockVelocityDays);

      // If API Key is configured, attempt actual call to Gemini API
      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey) {
        callGeminiAPI(analysisReport, geminiKey, callback);
      } else {
        const promptSummary = generateAIText(analysisReport);
        callback(null, {
          summary: promptSummary,
          detailedAnalysis: analysisReport,
          isGeminiActive: false
        });
      }
    });
}

function generateAIText(analysisReport) {
  let summary = `🤖 **AI Inventory Assistant Report**\n\n`;
  
  const critical = analysisReport.filter(a => a.priority === 1);
  const warning = analysisReport.filter(a => a.priority === 2);
  const regular = analysisReport.filter(a => a.priority === 3 && a.stockVelocityDays < 999);

  if (critical.length > 0) {
    summary += `⚠️ **CRITICAL RESTOCK ACTIONS REQUIRED (${critical.length})**:\n`;
    critical.forEach(c => {
      summary += `- **${c.name}** (${c.status}): Currently **${c.stock}** in stock. ${c.recommendation}\n`;
    });
    summary += `\n`;
  }

  if (warning.length > 0) {
    summary += `📊 **LOW STOCK WARNINGS (${warning.length})**:\n`;
    warning.forEach(w => {
      summary += `- **${w.name}**: **${w.stock}** units remaining. ${w.recommendation}\n`;
    });
    summary += `\n`;
  }

  summary += `📈 **General Inventory Insight**:\n`;
  if (critical.length === 0 && warning.length === 0) {
    summary += `All stock levels are currently healthy! Continue tracking daily transactions.\n`;
  } else {
    summary += `Focus replenishment efforts on the critical high-priority items listed above to avoid missing sales opportunities. `;
    const overstocked = analysisReport.filter(a => a.status === 'Overstocked');
    if (overstocked.length > 0) {
      summary += `Additionally, you have ${overstocked.length} overstocked item(s) where capital is locked.`;
    }
  }

  return summary;
}

/**
 * Call Gemini API using the official @google/generative-ai SDK
 */
async function callGeminiAPI(analysisReport, apiKey, callback) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `You are an expert SME retail business consultant in Nairobi, Kenya. Analyze the following inventory data and give a highly detailed, professional restocking advice and sales suggestions for the business owner. Keep it practical, actionable, and refer to M-Pesa transactions/local Nairobi retail patterns if helpful. Use markdown formatting with bullet points and bold text for clarity. Keep the response under 400 words.

Inventory Data:
${JSON.stringify(analysisReport, null, 2)}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiText = response.text();

    callback(null, {
      summary: aiText,
      detailedAnalysis: analysisReport,
      isGeminiActive: true
    });

  } catch (err) {
    console.error('Gemini API error, returning fallback:', err.message);
    callback(null, {
      summary: generateAIText(analysisReport) + '\n\n*(Note: Gemini API error — fallback analytical engine report shown)*',
      detailedAnalysis: analysisReport,
      isGeminiActive: false
    });
  }
}

/**
 * Handle a freeform AI chat question using Gemini
 */
async function handleAIChatQuestion(question, inventoryContext, callback) {
  const geminiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiKey) {
    // Rule-based fallback for chat
    let answer = generateFallbackChatAnswer(question);
    return callback(null, { answer, isGeminiActive: false });
  }

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `You are an expert retail business AI assistant for a Nairobi-based electronics and gadgets shop called "Zayre Gadgets". You help with inventory management, sales strategy, and restocking decisions.

Current Inventory Context:
${inventoryContext}

The shop owner asks: "${question}"

Give a concise, actionable, professional response. Use markdown formatting. Keep it under 200 words. Reference specific products from the inventory data when relevant.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const answer = response.text();

    callback(null, { answer, isGeminiActive: true });

  } catch (err) {
    console.error('Gemini chat error:', err.message);
    let answer = generateFallbackChatAnswer(question);
    answer += '\n\n*(Gemini unavailable — rule-based response)*';
    callback(null, { answer, isGeminiActive: false });
  }
}

/**
 * Generate rule-based chat answers when Gemini is not available
 */
function generateFallbackChatAnswer(question) {
  const q = question.toLowerCase();

  if (q.includes('stock') || q.includes('restock') || q.includes('what to buy')) {
    return `Based on current records:\n\n- Check the Stock Velocity Warnings panel on the right for items that need immediate restocking.\n- Products with "Critical Stock" or "Out of Stock" status should be prioritized.\n- As a rule of thumb, restock items to cover at least 45 days of projected sales.`;
  } else if (q.includes('month') || q.includes('best') || q.includes('seller')) {
    return `To find your best-selling products:\n\n- Navigate to the Dashboard to see Monthly Best Sellers.\n- Products with the highest quantity sold per month are your top performers.\n- Focus your restocking budget on these high-velocity items first.`;
  } else if (q.includes('mpesa') || q.includes('payment') || q.includes('reconcil')) {
    return `For M-Pesa payment management:\n\n1. Use the M-Pesa Parser tab to reconcile SMS confirmations with pending orders.\n2. The system will auto-match payments by amount when possible.\n3. Keep pending orders reconciled to maintain accurate revenue reports.`;
  } else if (q.includes('price') || q.includes('discount') || q.includes('margin')) {
    return `Pricing recommendations:\n\n- Review overstocked items — consider running promotions to free up capital.\n- High-velocity items can sustain slight price increases (2-5%) without impacting sales.\n- Track competitor prices for smartphones especially, as that market is price-sensitive in Nairobi.`;
  } else {
    return `To maximize Nairobi retail shop growth:\n1. Reconcile outstanding M-Pesa SMS orders to keep accurate cash logs.\n2. Keep accessories stocked (high margin, fast movement).\n3. Keep smartphones stocked before seasonal school holidays.\n4. Review the AI Stock Velocity Warnings for specific product-level advice.`;
  }
}

module.exports = { getAIRecommendations, handleAIChatQuestion, isGeminiConfigured };

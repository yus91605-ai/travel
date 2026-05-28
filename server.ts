import express from 'express';
import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'data.json');
const PACKING_FILE = path.join(__dirname, 'packing.json');

// Helper to initialize modern GoogleGenAI client with official telemetry header
function getGeminiClient(): GoogleGenAI {
  const rawKey = process.env.api_key || process.env.GEMINI_API_KEY;
  if (!rawKey) {
    throw new Error('未偵測到 API Key，請至 [Settings > Secrets] 設定 GEMINI_API_KEY。');
  }
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// 100% Reliable Automatic Retry Mechanism to counter cold starts or transient timeouts
async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 2, delay = 500): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    console.warn(`[Gemini Retry] Error occurred during API call. Retrying in ${delay}ms... remaining retries: ${retries}. Error:`, error);
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retries - 1, delay * 2);
  }
}

// 100% Resilient parsing helper that handles Markdown code blocks, leading narrative, and formatting hiccups
function parseJSONRobust(text: string): any {
  if (!text) return null;
  let cleaned = text.trim();
  
  // Strip Markdown code fences if present 
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  }
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Extraction strategy to pick absolute outermost JSON boundaries
    const startBrace = cleaned.indexOf('{');
    const endBrace = cleaned.lastIndexOf('}');
    const startBracket = cleaned.indexOf('[');
    const endBracket = cleaned.lastIndexOf(']');
    
    if (startBrace !== -1 && endBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) {
      try {
        return JSON.parse(cleaned.substring(startBrace, endBrace + 1));
      } catch (innerErr) {
        console.warn('[Parser] Extraction of braced object failed:', innerErr);
      }
    } else if (startBracket !== -1 && endBracket !== -1) {
      try {
        return JSON.parse(cleaned.substring(startBracket, endBracket + 1));
      } catch (innerErr) {
        console.warn('[Parser] Extraction of bracketed array failed:', innerErr);
      }
    }
    throw e;
  }
}

// Initialize data files if they don't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
if (!fs.existsSync(PACKING_FILE)) {
  fs.writeFileSync(PACKING_FILE, JSON.stringify([
    { id: '1', text: '護照與證件', checked: false, category: '必備' },
    { id: '2', text: '充電頭與線材', checked: false, category: '電子' },
    { id: '3', text: '換洗衣服', checked: false, category: '衣物' }
  ]));
}

async function startServer() {
  const app = express();
  // Render.com uses the PORT environment variable
  const PORT = Number(process.env.PORT) || 3000;

  // IMPORTANT: Body parser must be before routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  console.log('[Server] Starting initialization...');

  // API Router
  const apiRouter = express.Router();

  // Test Route
  apiRouter.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'API is working' });
  });

  // AI Suggestion Route
  apiRouter.post('/ai/suggest', async (req, res) => {
    console.log('[Server] AI Suggestion Request received for:', req.body.city);
    try {
      const { city, date, days } = req.body;
      const ai = getGeminiClient();

      const datePrompt = date ? `在 ${date} 左右` : "在該季節";
      const daysPrompt = days ? `停留 ${days} 天` : "一趟深度旅遊";

      const prompt = `你是一位專業的旅遊規劃師。請針對城市「${city}」${datePrompt}、${daysPrompt}的旅遊推薦 3-5 個必去景點，並給出一個詳細的「第一天至最後一天」行程安排。
      請注意：敘述請以繁體中文回答，為提升讀取與顯示速度，講求精練與流暢，避免長篇大論、語氣冗長口水！`;

      const responseText = await retryWithBackoff(async () => {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                spots: { type: Type.STRING, description: "景點名稱點對點，例如：景點A、景點B、景點C，請極度簡潔" },
                itinerary: { type: Type.STRING, description: "第一天到最後一天的行程。條列呈現，例如：Day 1:\n- 景點A\n- 景點B\n\nDay 2:\n- 景點C" },
                budget: { type: Type.STRING, description: "預估金額（新台幣 TWD 項目合計）" },
                weather: { type: Type.STRING, description: "當地的氣候狀況與穿著建議（極度簡潔）" }
              },
              required: ["spots", "itinerary", "budget", "weather"]
            },
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
          }
        });
        return response.text || '{}';
      });

      console.log('[Server] AI Generation successful (Optimized)');
      res.json(parseJSONRobust(responseText));
    } catch (e: any) {
      console.error('[Server] AI Route Error:', e);
      res.status(500).json({ success: false, error: e.message || 'AI 規劃發生內部錯誤' });
    }
  });

  // AI Packing Suggestion
  apiRouter.post('/ai/packing', async (req, res) => {
    try {
      const { city, weather, days } = req.body;
      const ai = getGeminiClient();

      const prompt = `你是一位旅遊達人。請針對前往「${city}」、天氣「${weather}」、停留「${days}」天的旅行，精挑細選 10-12 個實用必備的行李項目。
      請涵蓋：必備文件、建議衣物、電子產品、個人生活用品。請以繁體中文回答，極簡精粹！`;

      const responseText = await retryWithBackoff(async () => {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: { 
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING, description: "行李項目名稱，例如：護照、防曬乳" },
                  category: { type: Type.STRING, description: "分類標籤（分類如下：必備、衣物、電子、生活、其他）" }
                },
                required: ["text", "category"]
              }
            },
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
          }
        });
        return response.text || '[]';
      });

      res.json(parseJSONRobust(responseText));
    } catch (e: any) {
      console.error('[Server] AI Packing Error:', e);
      res.status(500).json({ error: e.message || 'AI 獲取行李建議失敗' });
    }
  });

  // AI Local Vibe Guide
  apiRouter.post('/ai/vibes', async (req, res) => {
    try {
      const { city } = req.body;
      const ai = getGeminiClient();

      const prompt = `你是一位深具文青品味的旅行作家。請為「${city}」訂製一份精緻文青的「在地生活隨筆」。
      
      規範精神：
      1. 充滿在地文青溫度，故事敘述文字唯美，但為了提高展示速度，每個項目的介紹說明請嚴格限制在 40 字內，用最凝鍊的筆法吸引讀者！
      2. 美食 keyword 必須用具體英文方便圖片搜尋，如 "kyoto gyoza", "paris croissant"。
      
      包含：
      1. 英文地名。
      2. 3種必吃在地美食。
      3. 2種文青工藝紀念品。
      4. 2個慢活私房景點。`;

      const responseText = await retryWithBackoff(async () => {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: { 
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                city_en: { type: Type.STRING, description: "英文城市名稱，例如: Tokyo" },
                food: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "美食名" },
                      desc: { type: Type.STRING, description: "文青感描述，必小於40字" },
                      keyword: { type: Type.STRING, description: "地名+具體食物，英文，如: kyoto matcha toast" }
                    },
                    required: ["name", "desc", "keyword"]
                  }
                },
                souvenir: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "在地代表物/紀念品" },
                      reason: { type: Type.STRING, description: "推薦理由，必小於40字" },
                      keyword: { type: Type.STRING, description: "地名+具體物件，英文，如: kyoto fan" }
                    },
                    required: ["name", "reason", "keyword"]
                  }
                },
                spots: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "秘境景點" },
                      reason: { type: Type.STRING, description: "為何是秘境，必小於40字" },
                      tip: { type: Type.STRING, description: "慢活玩法，必小於40字" },
                      keyword: { type: Type.STRING, description: "地名+具體景點，英文，如: arashiyama bamboo forest" }
                    },
                    required: ["name", "reason", "tip", "keyword"]
                  }
                }
              },
              required: ["city_en", "food", "souvenir", "spots"]
            },
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
          }
        });
        return response.text || '{}';
      });

      console.log('[Server] AI Vibes successful (Optimized)');
      res.json(parseJSONRobust(responseText));
    } catch (e: any) {
      console.error('[Server] AI Vibes Route Error:', e);
      res.status(500).json({ error: e.message || 'AI 獲取靈感失敗' });
    }
  });

  // Real Google Image Search Proxy Route
  apiRouter.get('/image-search', async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: 'Missing query parameter "q"' });
      }

      console.log('[Server] Google Image search initiated for:', query);
      const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;

      // Simulate standard modern browser UA to receive correct CDN formats
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        }
      });

      if (!response.ok) {
        throw new Error(`Google Search responded with status: ${response.status}`);
      }

      const html = await response.text();

      // Clean, extremely robust regex matching for all gstatic CDN subdomains (encrypted-tbn0..9, tbn0..9, etc.)
      // Matches both standard HTML URLs and escaped backslash JSON/JS sequence URLs, either http or https.
      const broadRegex = /https?:\/\/[^"'\s\>\/]*gstatic\.com\/images\?q=tbn:[^"'\s\>&;]+/gi;
      const broadMatches = html.match(broadRegex) || [];

      const escapedRegex = /https?:\\\/\\\/[^"'\s\>\\\/]*gstatic\.com\\\/images\?q=tbn:[^"'\s\>\\&;]+/gi;
      const escapedMatches = html.match(escapedRegex) || [];
      const cleanEscapedMatches = escapedMatches.map(m => m.replace(/\\/g, ''));

      let matches = [...broadMatches, ...cleanEscapedMatches];

      if (matches && matches.length > 0) {
        // De-duplicate and get top 8 high-quality results
        const uniqueImages = Array.from(new Set(matches)).slice(0, 8);
        console.log(`[Server] Image search success. Found ${uniqueImages.length} images for query: "${query}"`);
        return res.json({ success: true, images: uniqueImages });
      }

      console.warn('[Server] No gstatic image sources matched in Google payload');
      return res.json({ success: false, message: 'No matches found', images: [] });
    } catch (err: any) {
      console.error('[Server] Google Search scraper failed:', err);
      return res.status(500).json({ success: false, error: err.message, images: [] });
    }
  });

  apiRouter.get('/travel', (req, res) => {
    console.log('[Server] GET /api/travel');
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: '讀取資料失敗' });
    }
  });

  // Packing API
  apiRouter.get('/packing', (req, res) => {
    try {
      const data = JSON.parse(fs.readFileSync(PACKING_FILE, 'utf-8'));
      res.json(data);
    } catch (e) {
      res.status(500).json([]);
    }
  });

  apiRouter.post('/packing', (req, res) => {
    try {
      const { text, category } = req.body;
      const data = JSON.parse(fs.readFileSync(PACKING_FILE, 'utf-8'));
      const newItem = {
        id: Math.random().toString(36).substring(2, 11),
        text,
        checked: false,
        category: category || '一般'
      };
      data.push(newItem);
      fs.writeFileSync(PACKING_FILE, JSON.stringify(data, null, 2));
      res.json(newItem);
    } catch (e) {
      res.status(500).json({ error: '儲存失敗' });
    }
  });

  apiRouter.patch('/packing/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { checked } = req.body;
      const data = JSON.parse(fs.readFileSync(PACKING_FILE, 'utf-8'));
      const item = data.find((i: any) => i.id === id);
      if (item) {
        if (checked !== undefined) item.checked = checked;
        fs.writeFileSync(PACKING_FILE, JSON.stringify(data, null, 2));
        res.json({ success: true });
      } else {
        res.status(404).json({ error: '找不到項目' });
      }
    } catch (e) {
      res.status(500).json({ error: '更新失敗' });
    }
  });

  apiRouter.delete('/packing/:id', (req, res) => {
    try {
      const { id } = req.params;
      let data = JSON.parse(fs.readFileSync(PACKING_FILE, 'utf-8'));
      data = data.filter((i: any) => i.id !== id);
      fs.writeFileSync(PACKING_FILE, JSON.stringify(data, null, 2));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: '刪除失敗' });
    }
  });

  apiRouter.post('/travel', (req, res) => {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      const newItem = {
        ...req.body,
        ID: Math.random().toString(36).substring(2, 11),
        狀態: '待出發',
        建立時間: new Date().toISOString()
      };
      data.push(newItem);
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: '儲存資料失敗' });
    }
  });

  apiRouter.put('/travel/:id/toggle', (req, res) => {
    try {
      const { id } = req.params;
      const { currentStatus } = req.body;
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      const itemIndex = data.findIndex((item: any) => item.ID === id);
      
      if (itemIndex > -1) {
        const newStatus = currentStatus === '已完成' ? '待出發' : '已完成';
        data[itemIndex].狀態 = newStatus;
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        res.json({ success: true, newStatus });
      } else {
        res.status(404).json({ success: false, error: '找不到該項目' });
      }
    } catch (e) {
      res.status(500).json({ success: false, error: '更新失敗' });
    }
  });

  apiRouter.delete('/travel/:id', (req, res) => {
    try {
      const { id } = req.params;
      let data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      const initialLength = data.length;
      data = data.filter((item: any) => item.ID !== id);
      
      if (data.length < initialLength) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, error: '找不到該項目' });
      }
    } catch (e) {
      res.status(500).json({ success: false, error: '刪除失敗' });
    }
  });

  // Register API Router
  app.use('/api', apiRouter);

  // Vite or Static files middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[Server] Critical start error:', err);
});


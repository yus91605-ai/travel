import express from 'express';
import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize AI Client lazily
let aiClient: GoogleGenAI | null = null;
function getAIClient() {
  if (!aiClient) {
    const rawKey = process.env.api_key || process.env.GEMINI_API_KEY;
    if (!rawKey) {
      throw new Error('未偵測到 API Key。請在 Settings -> Secrets 中設定名稱為 "api_key" 的密鑰。');
    }
    
    // 清除可能存在的引號或空格
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
    
    if (apiKey.length < 20) {
      throw new Error('偵測到的 API Key 長度異常，請確認是否填寫正確。');
    }

    console.log(`[AI] 初始化中... (Key 長度: ${apiKey.length})`);
    
    // 正確的初始化方式應傳入物件
    aiClient = new GoogleGenAI({ apiKey: apiKey });
  }
  return aiClient;
}

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // API Routes - Explicitly handle both with and without trailing slash
  const apiRouter = express.Router();

  // AI Suggestion Route
  apiRouter.post('/ai/suggest', async (req, res) => {
    try {
      const { city, date, days } = req.body;
      const ai = getAIClient();
      
      const datePrompt = date ? `在 ${date} 左右` : "在該季節";
      const daysPrompt = days ? `停留 ${days} 天` : "一趟深度旅遊";

      const prompt = `你是一位專業的旅遊規劃師。請針對城市「${city}」${datePrompt}、${daysPrompt}的旅遊推薦 3-5 個必去景點，並給出一個詳細的「第一天至最後一天」行程安排。行程安排請務必使用條列式呈現（例如：Day 1: \n - 景點A \n - 景點B...），並包含預估預算（以 TWD 為單位）以及當地的氣候狀況。請以繁體中文回答，並以 JSON 格式回傳，格式如下：{"spots": "景點A、景點B...", "itinerary": "Day 1:...\\nDay 2:...", "budget": "預估金額", "weather": "氣候狀況"}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const text = response.text;
      if (!text) {
          throw new Error('AI 回傳內容為空');
      }
      
      res.json(JSON.parse(text));
    } catch (e: any) {
      console.error('[AI Error]', e);
      res.status(500).json({ 
        success: false, 
        error: e.message || 'AI 規劃失敗' 
      });
    }
  });

  apiRouter.get('/travel', (req, res) => {
    console.log(`[Server] Handling GET /api/travel`);
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      res.json(data);
    } catch (e) {
      console.error(`[Server] Error reading data:`, e);
      res.status(500).json({ success: false, error: 'Failed to read data' });
    }
  });

  apiRouter.post('/travel', (req, res) => {
    console.log(`[Server] Handling POST /api/travel`, req.body);
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
      res.status(500).json({ success: false, error: 'Failed to save data' });
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
        res.status(404).json({ success: false, error: 'Item not found' });
      }
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to update data' });
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
        res.status(404).json({ success: false, error: 'Item not found' });
      }
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to delete data' });
    }
  });

  app.use('/api', apiRouter);

  // Fallback for missing API routes - return JSON instead of HTML
  app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: 'API route not found' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

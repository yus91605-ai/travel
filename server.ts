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
const PACKING_FILE = path.join(__dirname, 'packing.json');

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
      
      const rawKey = process.env.api_key || process.env.GEMINI_API_KEY;
      if (!rawKey) {
        return res.status(401).json({ success: false, error: '未偵測到 API Key，請檢查 Secrets 設定。' });
      }
      
      const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
      const ai = new GoogleGenAI({ apiKey });

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

      console.log('[Server] AI Generation successful');
      res.json(JSON.parse(response.text || '{}'));
    } catch (e: any) {
      console.error('[Server] AI Route Error:', e);
      res.status(500).json({ success: false, error: e.message || 'AI 規劃發生內部錯誤' });
    }
  });

  // AI Packing Suggestion
  apiRouter.post('/ai/packing', async (req, res) => {
    try {
      const { city, weather, days } = req.body;
      const rawKey = process.env.api_key || process.env.GEMINI_API_KEY;
      if (!rawKey) return res.status(401).json({ error: 'Missing API Key' });
      
      const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
      const ai = new GoogleGenAI({ apiKey });

      const prompt = `你是一位旅遊專家。請針對前往「${city}」、天氣「${weather}」、停留「${days}」天的一趟旅行，列出建議攜帶的 10-15 個行李項目。
      請務必包含：必備文件、建議衣物、電子產品、個人藥品/生活用品。
      請以繁體中文回答，並以 JSON 陣列格式回傳，格式如下：[{"text": "項目名稱", "category": "分類名稱"}] (分類預計有：必備、衣物、電子、生活、其他)`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      res.json(JSON.parse(response.text || '[]'));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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


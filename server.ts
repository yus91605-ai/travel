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

      const prompt = `你是一位專業的旅遊規劃師。請針對城市「${city}」${datePrompt}、${daysPrompt}的旅遊推薦 3-5 個必去景點，並給出一個詳細的「第一天至最後一天」行程安排。行程安排請務必使用條列式呈現（例如：Day 1: \n - 景點A \n - 景點B...），並包含預估預算（以 TWD 為單位）以及當地的氣候狀況。請以繁體中文回答，並以 JSON 格式回傳，格式如下：{"spots": "景點A、景點B...", "itinerary": "Day 1:...\\nDay 2:...", "budget": "預估金額", "weather": "氣候狀況"}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
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
      const ai = getGeminiClient();

      const prompt = `你是一位旅遊專家。請針對前往「${city}」、天氣「${weather}」、停留「${days}」天的一趟旅行，列出建議攜帶的 10-15 個行李項目。
      請務必包含：必備文件、建議衣物、電子產品、個人藥品/生活用品。
      請以繁體中文回答，並以 JSON 陣列格式回傳，格式如下：[{"text": "項目名稱", "category": "分類名稱"}] (分類預計有：必備、衣物、電子、生活、其他)`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      res.json(JSON.parse(response.text || '[]'));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // AI Local Vibe Guide
  apiRouter.post('/ai/vibes', async (req, res) => {
    try {
      const { city } = req.body;
      const ai = getGeminiClient();

      const prompt = `你是一位深具「文青、在地探索、不走馬看花」美學眼光的獨立旅行家與旅遊作家。請為「${city}」這個地方/城市/國家深度量身打造一份專屬的「在地靈感指南」。
      
      請依循以下的核心精神：
      1. 文青與在地探索風格：文筆具有溫度與質感，描述時能點出物件背後的故事、溫度、文化本質或街角的職人精神，避免流於俗套與商業化的大眾觀光標籤。
      2. 深入地方脈絡：挖掘唯有深度漫步者、當地人才知道的隱藏美味、歷史工藝或低調迷人的小眾角落（例如獨立書店、深夜咖啡、小農職人坊、未經人工雕琢的自然祕境或社區聚落）。
      3. 精準圖文相符（極重要）：為了確保前端搭配 Google 圖片搜尋及 Unsplash 圖片時「圖文完全相符」，在產出 "keyword" 時必須使用「精準、具象、高視覺特徵、能在英文搜尋中 100% 正確匹配」的字詞組合。切忌使用籠統字眼（如 "food"、"market"、"beautiful"），應使用具備該地名與具體事物特徵的組合，如 "honduras baleada street food", "honduras copan ruins stela"。
      
      請包含：
      1. 該城市/地方的英文名稱 (例如台北為 Taipei、京都為 Kyoto、宏都拉斯為 Honduras 等)。
      2. 必吃在地美食 (3個)：名稱、一段簡短文青誘人的故事性描述、該食物精準的英文關鍵字（格式為: "地點+具體食物名"，例如 "honduras baleadas"）。
      3. 特色在地代表物/紀念品 (2個)：名稱、兼具深度與文青感的推薦理由、該項目精準的英文關鍵字（格式為: "地點+具體事物名"，例如 "honduras clay pottery" 或 "honduras lenca textile"）。
      4. 慢活秘境/私房景點 (2個)：名稱、為什麼它是秘境/故事/文化價值、漫步旅行小撇步、該景點精準的英文關鍵字（格式為: "地點+具體景點名"，例如 "copan ruins archaeological site" 或 "pulhapanzak waterfall honduras"）。
      
      請以繁體中文回答，並以 JSON 格式回傳，格式如下：
      {
        "city_en": "英文城市名稱",
        "food": [{"name": "名稱", "desc": "描述", "keyword": "english_keyword"}, ...],
        "souvenir": [{"name": "名稱", "reason": "理由", "keyword": "english_keyword"}, ...],
        "spots": [{"name": "名稱", "reason": "為何是秘境", "tip": "小撇步", "keyword": "english_keyword"}, ...]
      }`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const responseText = response.text || '{}';
      console.log('[Server] AI Vibes raw response:', responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
      
      res.json(JSON.parse(responseText));
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


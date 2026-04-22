import express from 'express';
import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'data.json');

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

  apiRouter.get('/travel', (req, res) => {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to read data' });
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

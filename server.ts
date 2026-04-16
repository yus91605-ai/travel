import express from 'express';
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

  // API Routes
  app.get('/api/travel', (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    res.json(data);
  });

  app.post('/api/travel', (req, res) => {
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
  });

  app.put('/api/travel/:id/toggle', (req, res) => {
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
  });

  app.delete('/api/travel/:id', (req, res) => {
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

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// 数据库配置，优先使用环境变量（Docker 模式），否则使用本地配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'czo_note',
  port: parseInt(process.env.DB_PORT || '3306')
};

// 初始化数据库表
async function initDb() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    console.log('Successfully connected to MySQL');

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id BIGINT PRIMARY KEY,
        title VARCHAR(255),
        content TEXT,
        createdAt BIGINT,
        updatedAt BIGINT,
        sortOrder INT,
        startDate VARCHAR(20),
        endDate VARCHAR(20)
      )
    `);

    // 检查并添加缺失的字段（用于旧表升级）
    const [columns] = await connection.execute('SHOW COLUMNS FROM notes');
    const columnNames = columns.map(c => c.Field);
    
    if (!columnNames.includes('startDate')) {
      await connection.execute('ALTER TABLE notes ADD COLUMN startDate VARCHAR(20)');
      console.log('Added startDate column to existing table');
    }
    if (!columnNames.includes('endDate')) {
      await connection.execute('ALTER TABLE notes ADD COLUMN endDate VARCHAR(20)');
      console.log('Added endDate column to existing table');
    }
    
    await connection.end();
  } catch (error) {
    console.error('Database connection error:', error.message);
  }
}

initDb();

// 获取所有笔记
app.get('/api/notes', async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM notes ORDER BY sortOrder ASC, updatedAt DESC');
    await connection.end();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 同步所有笔记（批量保存）
app.post('/api/notes/sync', async (req, res) => {
  const { notes } = req.body;
  if (!Array.isArray(notes)) {
    return res.status(400).json({ error: 'Invalid notes format' });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // 简单起见，这里采用“全量清空并重新插入”或“逐个插入/更新”的逻辑
    // 为了支持拖拽排序的顺序，全量重写是比较直接的方案（针对笔记数量不大的情况）
    await connection.execute('DELETE FROM notes');

    if (notes.length > 0) {
      const values = notes.map((note, index) => [
        note.id, 
        note.title || '无标题', 
        note.content || '', 
        note.createdAt || Date.now(), 
        note.updatedAt || Date.now(),
        index, // 使用当前索引作为排序字段
        note.startDate || '',
        note.endDate || ''
      ]);

      const sql = 'INSERT INTO notes (id, title, content, createdAt, updatedAt, sortOrder, startDate, endDate) VALUES ?';
      await connection.query(sql, [values]);
    }

    await connection.end();
    res.json({ message: 'Sync successful' });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除笔记
app.delete('/api/notes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('DELETE FROM notes WHERE id = ?', [id]);
    await connection.end();
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

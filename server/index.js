const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const os = require('os');

const app = express();
const port = process.env.PORT || 3005;

app.use(cors({
  origin: '*', // 在开发阶段允许所有来源，避免跨域报错
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// 数据库配置，优先使用环境变量（Docker 模式），否则使用本地配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost', // 优先使用指定的内网数据库地址
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'test',
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
        content LONGTEXT,
        createdAt BIGINT,
        updatedAt BIGINT,
        sortOrder INT,
        startDate VARCHAR(20),
        endDate VARCHAR(20)
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        mfa_secret VARCHAR(255),
        is_mfa_enabled BOOLEAN DEFAULT FALSE
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS sub_passwords (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        label VARCHAR(255),
        sub_password VARCHAR(255) NOT NULL,
        permissions JSON,
        createdAt BIGINT,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 插入默认用户 (如果不存在)
    const [userRows] = await connection.execute('SELECT * FROM users WHERE username = ?', ['admin']);
    if (userRows.length === 0) {
      await connection.execute('INSERT INTO users (username, password, is_mfa_enabled) VALUES (?, ?, FALSE)', ['admin', 'Sw..']);
      console.log('Default admin user created');
    } else {
      // 确保密码更新为 Sw.. 以符合用户习惯
      await connection.execute('UPDATE users SET password = ? WHERE username = ?', ['Sw..', 'admin']);
      // 如果 is_mfa_enabled 为 NULL，设置为 FALSE
      await connection.execute('UPDATE users SET is_mfa_enabled = FALSE WHERE username = ? AND is_mfa_enabled IS NULL', ['admin']);
    }

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
    if (!columnNames.includes('userId')) {
      await connection.execute('ALTER TABLE notes ADD COLUMN userId INT');
      // 为现有数据设置默认 userId (admin 的 ID 通常是 1)
      await connection.execute('UPDATE notes SET userId = 1 WHERE userId IS NULL');
      console.log('Added userId column to existing table');
    }

    // 检查 sub_passwords 表是否缺失 permissions 字段
    const [subColumns] = await connection.execute('SHOW COLUMNS FROM sub_passwords');
    const subColumnNames = subColumns.map(c => c.Field);
    if (!subColumnNames.includes('permissions')) {
      await connection.execute('ALTER TABLE sub_passwords ADD COLUMN permissions JSON AFTER sub_password');
      console.log('Added permissions column to sub_passwords table');
    }
    
    await connection.end();
  } catch (error) {
    console.error('Database connection error:', error.message);
    process.exit(1); // 初始化失败时退出程序，以便 Docker 重启
  }
}

initDb();

// 获取所有笔记
app.get('/api/notes', async (req, res) => {
  const { userId, permissions } = req.query;
  try {
    const connection = await mysql.createConnection(dbConfig);
    let sql = 'SELECT * FROM notes';
    let params = [];
    
    const conditions = [];
    if (userId) {
      conditions.push('userId = ?');
      params.push(userId);
    }

    // 处理子账户权限过滤
    if (permissions) {
      try {
        let allowedIds = permissions;
        if (typeof permissions === 'string' && permissions !== 'null' && permissions !== 'undefined') {
          allowedIds = JSON.parse(permissions);
        }
        
        if (Array.isArray(allowedIds) && allowedIds.length > 0) {
          // 修改为使用 id 过滤
          conditions.push('id IN (?)');
          params.push(allowedIds);
        }
      } catch (e) {
        console.error('Failed to parse permissions', e);
      }
    }
    
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    sql += ' ORDER BY sortOrder ASC, updatedAt DESC';
    
    const [rows] = await connection.query(sql, params);
    await connection.end();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 同步所有笔记（批量保存）
app.post('/api/notes/sync', async (req, res) => {
  const { notes, userId, isSubUser, permissions, subPasswordId } = req.body;
  if (!Array.isArray(notes)) {
    return res.status(400).json({ error: 'Invalid notes format' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    
    // 使用事务保证操作的原子性
    await connection.beginTransaction();

    try {
      if (isSubUser && (permissions || subPasswordId)) {
        // 子账户模式：加强校验，防止越权
        let allowedIds = [];
        
        // 尝试从数据库加载最权威的权限列表
        if (subPasswordId) {
          const [subRows] = await connection.execute('SELECT permissions FROM sub_passwords WHERE id = ?', [subPasswordId]);
          if (subRows.length > 0) {
            allowedIds = subRows[0].permissions;
            if (typeof allowedIds === 'string') {
              try { allowedIds = JSON.parse(allowedIds); } catch(e) { allowedIds = []; }
            }
          }
        }

        // 如果数据库没查到（可能旧版本前端没传 subPasswordId），回退到前端传参，但进行更严格的限定
        if ((!allowedIds || allowedIds.length === 0) && permissions) {
          allowedIds = permissions;
          if (typeof permissions === 'string' && permissions !== 'null' && permissions !== 'undefined') {
            try { allowedIds = JSON.parse(permissions); } catch(e) { allowedIds = []; }
          }
        }

        if (Array.isArray(allowedIds) && allowedIds.length > 0) {
          // 1. 删除其权限范围内的旧数据
          // 注意：此处必须同时校验 userId，防止删除其他用户的笔记
          await connection.query('DELETE FROM notes WHERE userId = ? AND id IN (?)', [userId, allowedIds]);

          // 2. 插入新数据（仅包含在权限范围内的笔记）
          const filteredNotes = notes.filter(n => allowedIds.includes(Number(n.id)) || allowedIds.includes(String(n.id)));
          if (filteredNotes.length > 0) {
            const values = filteredNotes.map((note, index) => [
              note.id, 
              note.title || '无标题', 
              note.content || '', 
              note.createdAt || Date.now(), 
              note.updatedAt || Date.now(),
              note.sortOrder || index, 
              note.startDate || '',
              note.endDate || '',
              userId
            ]);
            const sql = 'INSERT INTO notes (id, title, content, createdAt, updatedAt, sortOrder, startDate, endDate, userId) VALUES ?';
            await connection.query(sql, [values]);
          }
        }
      } else {
        // 主账户模式：保持原有逻辑
        if (userId) {
          await connection.execute('DELETE FROM notes WHERE userId = ?', [userId]);
        } else {
          await connection.execute('DELETE FROM notes');
        }

        if (notes.length > 0) {
          const values = notes.map((note, index) => [
            note.id, 
            note.title || '无标题', 
            note.content || '', 
            note.createdAt || Date.now(), 
            note.updatedAt || Date.now(),
            note.sortOrder !== undefined ? note.sortOrder : index,
            note.startDate || '',
            note.endDate || '',
            userId || 1
          ]);
          const sql = 'INSERT INTO notes (id, title, content, createdAt, updatedAt, sortOrder, startDate, endDate, userId) VALUES ?';
          await connection.query(sql, [values]);
        }
      }

      await connection.commit();
      res.json({ message: 'Sync successful' });
    } catch (innerError) {
      await connection.rollback();
      throw innerError;
    }
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// 删除笔记
app.delete('/api/notes/:id', async (req, res) => {
  const { id } = req.params;
  const { userId, isSubUser, subPasswordId, permissions } = req.query; // 从查询参数获取用户信息
  
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // 如果是子账户，校验权限
    if (isSubUser === 'true') {
      let allowedIds = [];
      if (subPasswordId) {
        const [subRows] = await connection.execute('SELECT permissions FROM sub_passwords WHERE id = ?', [subPasswordId]);
        if (subRows.length > 0) {
          allowedIds = subRows[0].permissions;
          if (typeof allowedIds === 'string') {
            try { allowedIds = JSON.parse(allowedIds); } catch(e) { allowedIds = []; }
          }
        }
      }
      
      if ((!allowedIds || allowedIds.length === 0) && permissions) {
        try {
          allowedIds = typeof permissions === 'string' ? JSON.parse(permissions) : permissions;
        } catch(e) { allowedIds = []; }
      }

      // 如果请求删除的 ID 不在授权列表中，拒绝操作
      if (!Array.isArray(allowedIds) || (!allowedIds.includes(Number(id)) && !allowedIds.includes(String(id)))) {
        await connection.end();
        return res.status(403).json({ error: '没有删除该笔记的权限' });
      }
    }

    // 执行删除操作，增加 userId 校验以防万一
    if (userId) {
      await connection.execute('DELETE FROM notes WHERE id = ? AND userId = ?', [id, userId]);
    } else {
      await connection.execute('DELETE FROM notes WHERE id = ?', [id]);
    }
    
    await connection.end();
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 登录接口
app.post('/api/auth/login', async (req, res) => {
  const { username, password, code } = req.body;
  console.log(`Login attempt for user: ${username}`);
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);
    await connection.end();

    if (rows.length === 0 || rows[0].password !== password) {
      console.log(`Login failed for user: ${username} - Invalid credentials`);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = rows[0];
    if (user.is_mfa_enabled) {
      if (!code) {
        return res.json({ requireMfa: true, message: '需要二次验证' });
      }
      const isValid = authenticator.check(code, user.mfa_secret);
      if (!isValid) {
        return res.status(401).json({ error: '验证码错误' });
      }
    }

    res.json({ success: true, user: { id: user.id, username: user.username, isMfaEnabled: user.is_mfa_enabled } });
  } catch (error) {
    console.error(`Login error for user ${username}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 子密码登录
app.post('/api/auth/sub-login', async (req, res) => {
  const { subPassword } = req.body;
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(`
      SELECT sp.*, u.username, u.is_mfa_enabled 
      FROM sub_passwords sp 
      JOIN users u ON sp.userId = u.id 
      WHERE sp.sub_password = ?
    `, [subPassword]);
    await connection.end();

    if (rows.length === 0) {
      return res.status(401).json({ error: '无效的子密码' });
    }

    const sub = rows[0];
    res.json({ 
      success: true, 
      user: { 
        id: sub.userId, 
        username: sub.username, 
        isSubUser: true, 
        label: sub.label,
        permissions: sub.permissions,
        subPasswordId: sub.id
      } 
    });
  } catch (error) {
    console.error('Sub-login error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 获取子密码列表
app.get('/api/auth/sub-passwords', async (req, res) => {
  const { username } = req.query;
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [userRows] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (userRows.length === 0) {
      await connection.end();
      return res.status(404).json({ error: '用户不存在' });
    }
    const [rows] = await connection.execute('SELECT * FROM sub_passwords WHERE userId = ? ORDER BY createdAt DESC', [userRows[0].id]);
    await connection.end();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加子密码
app.post('/api/auth/sub-passwords', async (req, res) => {
  const { username, label, permissions } = req.body;
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [userRows] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (userRows.length === 0) {
      await connection.end();
      return res.status(404).json({ error: '用户不存在' });
    }
    
    // 生成随机 8 位子密码
    const subPassword = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    await connection.execute(
      'INSERT INTO sub_passwords (userId, label, sub_password, permissions, createdAt) VALUES (?, ?, ?, ?, ?)',
      [userRows[0].id, label || '临时密码', subPassword, JSON.stringify(permissions || []), Date.now()]
    );

    // 获取权限描述（标题列表）
    let permissionsDesc = '全量';
    if (permissions && permissions.length > 0) {
      const [noteRows] = await connection.query('SELECT title FROM notes WHERE id IN (?)', [permissions]);
      permissionsDesc = noteRows.map(r => r.title || '无标题').join(', ');
    }

    await connection.end();
    res.json({ 
      success: true, 
      subPassword, 
      permissionsDesc 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除子密码
app.delete('/api/auth/sub-passwords/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('DELETE FROM sub_passwords WHERE id = ?', [id]);
    await connection.end();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取 2FA 绑定信息
app.get('/api/auth/mfa/setup', async (req, res) => {
  const { username } = req.query;
  console.log(`[MFA] Setup requested for user: ${username}`);
  try {
    // 显式检查库是否已加载
    if (!authenticator) throw new Error('authenticator 模块未加载');
    if (!QRCode) throw new Error('QRCode 模块未加载');

    const secret = authenticator.generateSecret();
    const otpauthPath = authenticator.keyuri(username || 'User', 'CZO-Note', secret);
    console.log(`[MFA] OTP Auth Path: ${otpauthPath}`);
    
    const qrCodeUrl = await QRCode.toDataURL(otpauthPath);
    console.log(`[MFA] QR Code generated successfully`);
    
    res.json({ secret, qrCodeUrl });
  } catch (error) {
    console.error(`[MFA] Setup error: ${error.stack}`);
    res.status(500).json({ 
      error: error.message, 
      stack: error.stack,
      hint: '请确保服务器已安装 otplib 和 qrcode'
    });
  }
});

// 启用 2FA
app.post('/api/auth/mfa/enable', async (req, res) => {
  const { username, secret, code } = req.body;
  console.log(`[MFA] Enabling for ${username}...`);
  try {
    const isValid = authenticator.check(code, secret);
    console.log(`[MFA] Code validation result: ${isValid}`);
    if (!isValid) {
      return res.status(400).json({ error: '验证码无效，请重试' });
    }

    const connection = await mysql.createConnection(dbConfig);
    const sql = 'UPDATE users SET mfa_secret = ?, is_mfa_enabled = 1 WHERE username = ?';
    console.log(`[MFA] Executing SQL: ${sql} with [${secret}, ${username}]`);
    const [result] = await connection.execute(sql, [secret, username]);
    await connection.end();
    console.log(`[MFA] DB Update result:`, result);
    res.json({ success: true });
  } catch (error) {
    console.error(`[MFA] Enable error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 禁用 2FA
app.post('/api/auth/mfa/disable', async (req, res) => {
  const { username, password } = req.body;
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0 || rows[0].password !== password) {
      await connection.end();
      return res.status(401).json({ error: '密码错误' });
    }
    await connection.execute('UPDATE users SET is_mfa_enabled = FALSE, mfa_secret = NULL WHERE username = ?', [username]);
    await connection.end();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取系统内网 IP 信息
app.get('/api/system/info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2];
      // 兼容 Node 18+ 的 family 字段 (可能是 'IPv4' 或 4)
      const family = address.family === 'IPv4' || address.family === 4;
      if (family && !address.internal) {
        addresses.push(address.address);
      }
    }
  }
  // 按照常见内网网段排序，优先展示 192.168.x.x
  addresses.sort((a, b) => {
    if (a.startsWith('192.168.')) return -1;
    if (b.startsWith('192.168.')) return 1;
    return 0;
  });
  res.json({ addresses });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

server.on('error', (err) => {
  console.error('Server listen error:', err);
});

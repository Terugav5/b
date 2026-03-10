const express = require('express');
const session = require('express-session');
const db = require('../utils/db');
const {
  publishQueues,
  deleteQueueById,
  deleteAllQueues
} = require('../utils/queuePublisher');
const { ensureMediatorPanelMessage, updateMediatorPanel } = require('../utils/panelManager');
const { guildId: configuredGuildId } = require('../config.json');

function startAdminPanel(client) {
  const app = express();
  const host = process.env.ADMIN_PANEL_HOST || '127.0.0.1';
  const port = Number(process.env.ADMIN_PANEL_PORT || 3000);
  const password = process.env.ADMIN_PANEL_PASSWORD || 'admin';
  const sessionSecret = process.env.ADMIN_PANEL_SESSION_SECRET || 'change-this-session-secret';

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(express.static('web/public'));
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax'
    }
  }));

  app.get('/', (req, res) => {
    if (req.session.authenticated) {
      return res.redirect('/admin');
    }
    return res.send(renderLogin());
  });

  app.post('/login', (req, res) => {
    if ((req.body.password || '') !== password) {
      return res.status(401).send(renderLogin('Senha incorreta.'));
    }

    req.session.authenticated = true;
    return res.redirect('/admin');
  });

  app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  app.use('/admin', (req, res, next) => {
    if (!req.session.authenticated) {
      if (wantsJson(req)) {
        return res.status(401).json({ ok: false, error: 'Não autenticado.' });
      }
      return res.redirect('/');
    }
    return next();
  });

  app.get('/admin', async (req, res) => {
    try {
      const guild = await getGuild(client);
      const data = await db.get();
      res.send(renderDashboard({
        guild,
        config: data.config || {},
        embedSettings: data.embedSettings || {},
        queues: data.queues || [],
        mediators: data.mediators || {},
        status: req.query.status || ''
      }));
    } catch (error) {
      res.status(500).send(renderError(error));
    }
  });

  app.post('/admin/mediators', async (req, res) => {
    try {
      const config = await db.get('config') || {};
      config.mediatorRole = req.body.mediatorRole;
      config.mediatorChannel = req.body.mediatorChannel;
      await db.set('config', config);

      const guild = await getGuild(client);
      await ensureMediatorPanelMessage(client, guild);
      await updateMediatorPanel(client, guild);

      return sendSuccess(req, res, 'Painel de mediadores configurado.');
    } catch (error) {
      return sendFailure(req, res, error);
    }
  });

  app.post('/admin/queues', async (req, res) => {
    try {
      const mode = req.body.mode;
      const type = req.body.type;
      const channelId = req.body.channelId;
      const values = String(req.body.values || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      const queues = await db.get('queues') || [];
      for (const value of values) {
        queues.push({
          id: `${mode}-${type}-${value}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          mode,
          type,
          value,
          channelId,
          players: [],
          messageId: ''
        });
      }

      await db.set('queues', queues);
      return sendSuccess(req, res, `Fila(s) adicionada(s): ${values.length}.`);
    } catch (error) {
      return sendFailure(req, res, error);
    }
  });

  app.post('/admin/embed-settings/queue', async (req, res) => {
    try {
      const embedSettings = await db.get('embedSettings') || {};
      embedSettings.queue = {
        color: req.body.color || '',
        title: req.body.title || '',
        description: req.body.description || '',
        thumbnail: req.body.thumbnail || '',
        image: req.body.image || '',
        footer: req.body.footer || ''
      };

      await db.set('embedSettings', embedSettings);
      return sendSuccess(req, res, 'Estilo da embed das filas salvo.');
    } catch (error) {
      return sendFailure(req, res, error);
    }
  });

  app.post('/admin/embed-settings/mediator', async (req, res) => {
    try {
      const embedSettings = await db.get('embedSettings') || {};
      embedSettings.mediator = {
        ...(embedSettings.mediator || {}),
        color: req.body.color || '',
        title: req.body.title || '',
        description: req.body.description || '',
        thumbnail: req.body.thumbnail || '',
        footer: req.body.footer || ''
      };

      await db.set('embedSettings', embedSettings);

      const guild = await getGuild(client);
      await updateMediatorPanel(client, guild);

      return sendSuccess(req, res, 'Aparência do painel de mediadores salva.');
    } catch (error) {
      return sendFailure(req, res, error);
    }
  });

  app.post('/admin/queues/delete', async (req, res) => {
    try {
      const result = await deleteQueueById(client, req.body.queueId);
      return sendSuccess(req, res, `Fila removida. Mensagens apagadas no Discord: ${result.deletedMessages}.`);
    } catch (error) {
      return sendFailure(req, res, error);
    }
  });

  app.post('/admin/queues/delete-all', async (req, res) => {
    try {
      const result = await deleteAllQueues(client);
      return sendSuccess(req, res, `Todas as filas foram removidas. Filas: ${result.removed}. Mensagens apagadas: ${result.deletedMessages}.`);
    } catch (error) {
      return sendFailure(req, res, error);
    }
  });

  app.post('/admin/queues/publish', async (req, res) => {
    try {
      const guild = await getGuild(client);
      const result = await publishQueues(client, guild.id);
      return sendSuccess(req, res, `Filas publicadas: ${result.count}.`);
    } catch (error) {
      return sendFailure(req, res, error);
    }
  });

  const server = app.listen(port, host, () => {
    console.log(`Admin panel running at http://${host}:${port}`);
    if (!process.env.ADMIN_PANEL_PASSWORD) {
      console.log('ADMIN_PANEL_PASSWORD não definido. Usando senha padrão insegura: admin');
    }
  });

  return server;
}

async function getGuild(client) {
  const guildId = process.env.GUILD_ID || configuredGuildId;
  const guild = guildId
    ? await client.guilds.fetch(guildId)
    : client.guilds.cache.first();

  if (!guild) {
    throw new Error('Nenhum servidor do Discord disponível para o painel.');
  }

  await guild.channels.fetch();
  await guild.roles.fetch();
  return guild;
}

function wantsJson(req) {
  return req.get('x-requested-with') === 'fetch' || req.accepts(['html', 'json']) === 'json';
}

function sendSuccess(req, res, message) {
  if (wantsJson(req)) {
    return res.json({ ok: true, message });
  }

  return res.redirect(`/admin?status=${encodeURIComponent(message)}`);
}

function sendFailure(req, res, error) {
  if (wantsJson(req)) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }

  return res.status(500).send(renderError(error));
}

function renderLogin(errorMessage = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login | Painel Admin</title>
  <link rel="icon" href="/icon.jpg">
  <style>
    :root {
      --bg: #1a1a2a;
      --surface: #2a2a3a;
      --surface-hover: #3a3a4a;
      --border: #3a3a4a;
      --text: #ffffff;
      --text-muted: #808080;
      --accent: #e50914;
      --accent-hover: #f40612;
      --error: #e50914;
      --success: #22c55e;
      --shadow: 0 0 40px rgba(229, 9, 20, 0.15);
    }
    
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }
    
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background-image: 
        radial-gradient(circle at 20% 50%, rgba(229, 9, 20, 0.08) 0%, transparent 50%),
        radial-gradient(circle at 80% 80%, rgba(244, 6, 18, 0.05) 0%, transparent 50%);
    }
    
    .login-container {
      width: 100%;
      max-width: 420px;
      padding: 0 24px;
    }
    
    .login-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 48px;
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }
    
    .login-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, var(--accent), var(--accent-hover), var(--accent));
    }
    
    h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }
    
    .subtitle {
      color: var(--text-muted);
      font-size: 15px;
      margin-bottom: 32px;
    }
    
    .input-group {
      position: relative;
      margin-bottom: 20px;
    }
    
    input {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      color: var(--text);
      font-size: 15px;
      transition: all 0.2s;
      outline: none;
    }
    
    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    
    input::placeholder {
      color: var(--text-muted);
    }
    
    button {
      width: 100%;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 12px;
      padding: 14px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 8px;
    }
    
    button:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
    }
    
    button:active {
      transform: translateY(0);
    }
    
    .error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: var(--error);
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 14px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .error::before {
      content: '⚠';
    }
    
    @media (max-width: 480px) {
      .login-card {
        padding: 32px 24px;
      }
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      <div class="logo">
      </div>
      <h1>Bem-vindo de volta</h1>
      <p class="subtitle">Painel de administração do bot</p>
      
      ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ''}
      
      <form method="post" action="/login">
        <div class="input-group">
          <input 
            type="password" 
            name="password" 
            placeholder="Digite sua senha" 
            required
            autocomplete="current-password"
          >
        </div>
        <button type="submit">Entrar no painel</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

function renderDashboard({ guild, config, embedSettings, queues, mediators, status }) {
  const textChannels = guild.channels.cache
    .filter((channel) => channel && typeof channel.isTextBased === 'function' && channel.isTextBased() && channel.type === 0)
    .sort((a, b) => a.position - b.position);
  const roles = guild.roles.cache
    .filter((role) => role.name !== '@everyone')
    .sort((a, b) => b.position - a.position);

  const mediatorRows = Object.entries(mediators)
    .map(([userId, data]) => `
          <tr>
            <td>
              <div class="user-cell">
                <div class="avatar">${(data.name || userId).charAt(0).toUpperCase()}</div>
                <span>${escapeHtml(data.name || userId)}</span>
              </div>
            </td>
            <td>
              <span class="badge ${data.online ? 'badge-success' : 'badge-neutral'}">
                ${data.online ? '● Online' : '○ Offline'}
              </span>
            </td>
            <td class="mono">${escapeHtml(data.pix || '-')}</td>
          </tr>
        `).join('');

  const queueRows = queues
    .map((queue) => `
          <tr id="queue-row-${escapeHtml(queue.id)}">
            <td><span class="mode-badge mode-${queue.mode}">${escapeHtml(queue.mode)}</span></td>
            <td><span class="type-badge">${escapeHtml(queue.type)}</span></td>
            <td class="mono highlight">R$ ${escapeHtml(queue.value)}</td>
            <td class="mono text-muted">#${escapeHtml(textChannels.find(c => c.id === queue.channelId)?.name || queue.channelId)}</td>
            <td>
              <div class="player-count">
                <span class="count-icon">👥</span>
                <span>${queue.players.length}</span>
              </div>
            </td>
            <td>
              <button class="btn-icon danger ajax-button" data-endpoint="/admin/queues/delete" data-queue-id="${escapeHtml(queue.id)}" title="Remover fila">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
              </button>
            </td>
          </tr>
        `).join('');

  const queueStyle = embedSettings.queue || {};
  const mediatorStyle = embedSettings.mediator || {};

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard | Painel Admin</title>
  <link rel="icon" href="/icon.jpg">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    :root {
      --bg: #1a1a2a;
      --surface: #2a2a3a;
      --surface-elevated: #1a1a25;
      --surface-hover: #3a3a4a;
      --border: #3a3a4a;
      --border-strong: #4a4a5a;
      --text: #ffffff;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --accent: #e50914;
      --accent-hover: #f40612;
      --accent-light: rgba(229, 9, 20, 0.1);
      --success: #22c55e;
      --success-light: rgba(34, 197, 94, 0.1);
      --warning: #f59e0b;
      --danger: #ef4444;
      --danger-light: rgba(239, 68, 68, 0.1);
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
      --shadow: 0 4px 6px -1px rgba(0,0,0,0.4);
      --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5);
      --radius-sm: 8px;
      --radius: 12px;
      --radius-lg: 16px;
      --radius-xl: 24px;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
      background-image: 
        radial-gradient(circle at 0% 0%, rgba(229, 9, 20, 0.08) 0%, transparent 50%),
        radial-gradient(circle at 100% 100%, rgba(244, 6, 18, 0.05) 0%, transparent 50%);
    }
    
    /* Layout */
    .layout {
      display: grid;
      grid-template-columns: 260px 1fr;
      min-height: 100vh;
    }
    
    /* Sidebar */
    .sidebar {
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 24px;
      display: flex;
      flex-direction: column;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }
    
    .brand-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--accent), var(--accent-hover));
      border-radius: var(--radius);
      display: grid;
      place-items: center;
      font-size: 20px;
    }
    
    .brand-text h1 {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    
    .brand-text span {
      font-size: 12px;
      color: var(--text-muted);
    }
    
    .nav-section {
      margin-bottom: 24px;
    }
    
    .nav-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 12px;
      font-weight: 600;
    }
    
    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: var(--radius);
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
      margin-bottom: 4px;
      cursor: pointer;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }
    
    .nav-item:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
    
    .nav-item.active {
      background: var(--accent-light);
      color: var(--accent);
    }
    
    .nav-icon {
      width: 20px;
      height: 20px;
      opacity: 0.7;
    }
    
    .sidebar-footer {
      margin-top: auto;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }
    
    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    
    .user-avatar {
      width: 36px;
      height: 36px;
      background: var(--surface-elevated);
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid var(--border);
    }
    
    .user-details {
      flex: 1;
    }
    
    .user-name {
      font-size: 14px;
      font-weight: 600;
    }
    
    .user-role {
      font-size: 12px;
      color: var(--text-muted);
    }
    
    .btn-logout {
      width: 100%;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 8px;
      border-radius: var(--radius);
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-logout:hover {
      background: var(--danger-light);
      border-color: var(--danger);
      color: var(--danger);
    }
    
    /* Main Content */
    .main {
      padding: 32px;
      overflow-y: auto;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
    }
    
    .header-content h2 {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    
    .header-content p {
      color: var(--text-secondary);
      font-size: 15px;
    }
    
    .header-actions {
      display: flex;
      gap: 12px;
    }
    
    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      position: relative;
      overflow: hidden;
    }
    
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, var(--accent), var(--accent-hover));
      opacity: 0.5;
    }
    
    .stat-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    
    .stat-icon {
      width: 40px;
      height: 40px;
      background: var(--accent-light);
      border-radius: var(--radius);
      display: grid;
      place-items: center;
      font-size: 20px;
    }
    
    .stat-badge {
      font-size: 12px;
      padding: 4px 8px;
      background: var(--success-light);
      color: var(--success);
      border-radius: 20px;
      font-weight: 600;
    }
    
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }
    
    .stat-label {
      color: var(--text-muted);
      font-size: 14px;
    }
    
    /* Content Grid */
    .content-grid {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 24px;
      margin-bottom: 24px;
    }
    
    @media (max-width: 1200px) {
      .content-grid {
        grid-template-columns: 1fr;
      }
    }
    
    /* Cards */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    
    .card-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .card-title {
      font-size: 16px;
      font-weight: 600;
    }
    
    .card-subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    
    .card-body {
      padding: 24px;
    }
    
    /* Form Elements */
    .form-group {
      margin-bottom: 20px;
    }
    
    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .form-control {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 14px;
      color: var(--text);
      font-size: 14px;
      transition: all 0.2s;
      outline: none;
      font-family: inherit;
    }
    
    .form-control:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-light);
    }
    
    select.form-control {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2371717a' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 14px center;
      padding-right: 40px;
    }
    
    textarea.form-control {
      resize: vertical;
      min-height: 100px;
      line-height: 1.6;
    }
    
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    
    @media (max-width: 640px) {
      .form-row {
        grid-template-columns: 1fr;
      }
    }
    
    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: var(--radius);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      outline: none;
      text-decoration: none;
    }
    
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    
    .btn-primary:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
    }
    
    .btn-secondary {
      background: var(--surface-elevated);
      color: var(--text);
      border: 1px solid var(--border);
    }
    
    .btn-secondary:hover {
      background: var(--surface-hover);
      border-color: var(--border-strong);
    }
    
    .btn-danger {
      background: var(--danger-light);
      color: var(--danger);
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    
    .btn-danger:hover {
      background: var(--danger);
      color: white;
    }
    
    .btn-ghost {
      background: transparent;
      color: var(--text-secondary);
    }
    
    .btn-ghost:hover {
      color: var(--text);
      background: var(--surface-hover);
    }
    
    .btn-sm {
      padding: 6px 12px;
      font-size: 13px;
    }
    
    .btn-icon {
      width: 36px;
      height: 36px;
      padding: 0;
      display: grid;
      place-items: center;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      border-radius: var(--radius);
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-icon:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
    
    .btn-icon.danger:hover {
      background: var(--danger-light);
      border-color: var(--danger);
      color: var(--danger);
    }
    
    /* Tables */
    .table-container {
      overflow-x: auto;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    
    th {
      text-align: left;
      padding: 12px 16px;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    
    td {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    
    tr:hover td {
      background: var(--surface-hover);
    }
    
    tr:last-child td {
      border-bottom: none;
    }
    
    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .badge-success {
      background: var(--success-light);
      color: var(--success);
    }
    
    .badge-neutral {
      background: var(--surface-elevated);
      color: var(--text-muted);
    }
    
    .mode-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .mode-mobile { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
    .mode-emulador { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
    .mode-tatico { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    .mode-misto { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    
    .type-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 8px;
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      font-family: monospace;
    }
    
    /* Utilities */
    .mono {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 13px;
    }
    
    .highlight {
      color: var(--accent);
      font-weight: 600;
    }
    
    .text-muted {
      color: var(--text-muted);
    }
    
    .user-cell {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .avatar {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--accent), var(--accent-hover));
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 700;
      color: white;
    }
    
    .player-count {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-secondary);
    }
    
    .count-icon {
      opacity: 0.5;
    }
    
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-muted);
    }
    
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.3;
    }
    
    /* Alert */
    .alert {
      position: fixed;
      top: 24px;
      right: 24px;
      padding: 16px 20px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 1000;
      transform: translateX(400px);
      transition: transform 0.3s ease;
      max-width: 400px;
    }
    
    .alert.show {
      transform: translateX(0);
    }
    
    .alert-success {
      border-left: 3px solid var(--success);
    }
    
    .alert-error {
      border-left: 3px solid var(--danger);
    }
    
    .alert-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 700;
    }
    
    .alert-success .alert-icon {
      background: var(--success-light);
      color: var(--success);
    }
    
    .alert-error .alert-icon {
      background: var(--danger-light);
      color: var(--danger);
    }
    
    /* Tabs */
    .tabs {
      display: flex;
      gap: 4px;
      padding: 4px;
      background: var(--bg);
      border-radius: var(--radius);
      margin-bottom: 24px;
      width: fit-content;
    }
    
    .tab {
      padding: 8px 16px;
      border-radius: var(--radius-sm);
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      border: none;
      background: transparent;
      transition: all 0.2s;
    }
    
    .tab:hover {
      color: var(--text);
    }
    
    .tab.active {
      background: var(--surface-elevated);
      color: var(--text);
      box-shadow: var(--shadow-sm);
    }
    
    /* Responsive */
    @media (max-width: 1024px) {
      .layout {
        grid-template-columns: 1fr;
      }
      
      .sidebar {
        display: none;
      }
      
      .main {
        padding: 20px;
      }
    }
    
    /* Section visibility */
    .section {
      display: none;
    }
    
    .section.active {
      display: block;
    }
    
    /* Quick Actions */
    .quick-actions {
      display: grid;
      gap: 12px;
    }
    
    .quick-action-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      text-decoration: none;
      transition: all 0.2s;
      cursor: pointer;
      width: 100%;
      text-align: left;
    }
    
    .quick-action-btn:hover {
      background: var(--surface-hover);
      border-color: var(--border-strong);
      transform: translateX(4px);
    }
    
    .quick-action-icon {
      width: 40px;
      height: 40px;
      background: var(--accent-light);
      border-radius: var(--radius);
      display: grid;
      place-items: center;
      font-size: 20px;
    }
    
    .quick-action-content {
      flex: 1;
    }
    
    .quick-action-title {
      font-weight: 600;
      font-size: 14px;
    }
    
    .quick-action-desc {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    
    .danger-zone {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }
    
    .danger-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--danger);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-text">
          <h1>Bot Admin</h1>
          <span>Painel de Controle</span>
        </div>
      </div>
      
      <nav>
        <div class="nav-section">
          <div class="nav-title">Menu Principal</div>
          <button class="nav-item active" onclick="showSection('dashboard')">
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
            </svg>
            Dashboard
          </button>
          <button class="nav-item" onclick="showSection('queues')">
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
            </svg>
            Filas
          </button>
          <button class="nav-item" onclick="showSection('mediators')">
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
            Mediadores
          </button>
          <button class="nav-item" onclick="showSection('embeds')">
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="9" y1="21" x2="9" y2="9"/>
            </svg>
            Aparência
          </button>
        </div>
      </nav>
      
      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-avatar">A</div>
          <div class="user-details">
            <div class="user-name">Administrador</div>
            <div class="user-role">Gerenciamento</div>
          </div>
        </div>
        <form method="post" action="/logout">
          <button type="submit" class="btn-logout">Sair do painel</button>
        </form>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main">
      <!-- Alert Container -->
      <div id="alert-container"></div>
      
      <!-- Header -->
      <div class="header">
        <div class="header-content">
          <h2>Dashboard</h2>
          <p>Gerenciando servidor: <strong>${escapeHtml(guild.name)}</strong></p>
        </div>
        <div class="header-actions">
          <button class="btn btn-secondary" onclick="showSection('queues')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Nova Fila
          </button>
          <button class="btn btn-primary ajax-button" data-endpoint="/admin/queues/publish">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17,8 12,3 7,8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Publicar no Discord
          </button>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-icon">📋</div>
            <span class="stat-badge">Ativo</span>
          </div>
          <div class="stat-value" id="stat-queues">${queues.length}</div>
          <div class="stat-label">Filas cadastradas</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-icon" style="background: var(--success-light);">👥</div>
          </div>
          <div class="stat-value" id="stat-mediators">${Object.keys(mediators).length}</div>
          <div class="stat-label">Mediadores Configurados</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">💰</div>
          </div>
          <div class="stat-value" id="stat-volume">${queues.reduce((acc, q) => acc + (Number(q.value) * q.players.length), 0)}</div>
          <div class="stat-label">Volume em jogo (R$)</div>
        </div>
      </div>

      <!-- Dashboard Section -->
      <div id="section-dashboard" class="section active">
        <div class="content-grid">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Filas Recentes</div>
                <div class="card-subtitle">Últimas filas cadastradas no sistema</div>
              </div>
              <button class="btn btn-ghost btn-sm" onclick="showSection('queues')">Ver todas</button>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Modo</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                    <th>Jogadores</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${queues.slice(0, 5).map(queue => `
                    <tr id="queue-row-dash-${escapeHtml(queue.id)}">
                      <td><span class="mode-badge mode-${queue.mode}">${escapeHtml(queue.mode)}</span></td>
                      <td><span class="type-badge">${escapeHtml(queue.type)}</span></td>
                      <td class="mono highlight">R$ ${escapeHtml(queue.value)}</td>
                      <td>
                        <div class="player-count">
                          <span class="count-icon">👥</span>
                          <span>${queue.players.length}</span>
                        </div>
                      </td>
                      <td>
                        <button class="btn-icon danger ajax-button" data-endpoint="/admin/queues/delete" data-queue-id="${escapeHtml(queue.id)}">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  `).join('') || `
                    <tr>
                      <td colspan="5">
                        <div class="empty-state">
                          <div class="empty-state-icon">📭</div>
                          <p>Nenhuma fila cadastrada ainda</p>
                        </div>
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div class="card" style="margin-bottom: 24px;">
              <div class="card-header">
                <div>
                  <div class="card-title">Ações Rápidas</div>
                  <div class="card-subtitle">Atalhos para tarefas comuns</div>
                </div>
              </div>
              <div class="card-body">
                <div class="quick-actions">
                  <button class="quick-action-btn" onclick="showSection('queues')">
                    <div class="quick-action-icon">➕</div>
                    <div class="quick-action-content">
                      <div class="quick-action-title">Criar Nova Fila</div>
                      <div class="quick-action-desc">Adicionar fila de partidas</div>
                    </div>
                  </button>
                  
                  <button class="quick-action-btn" onclick="showSection('mediators')">
                    <div class="quick-action-icon" style="background: var(--success-light);">⚙️</div>
                    <div class="quick-action-content">
                      <div class="quick-action-title">Configurar Mediadores</div>
                      <div class="quick-action-desc">Gerenciar cargo e canal</div>
                    </div>
                  </button>
                  
                  <button class="quick-action-btn ajax-button" data-endpoint="/admin/queues/publish">
                    <div class="quick-action-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">📢</div>
                    <div class="quick-action-content">
                      <div class="quick-action-title">Publicar Filas</div>
                      <div class="quick-action-desc">Enviar para o Discord</div>
                    </div>
                  </button>
                </div>
                
                <div class="danger-zone">
                  <div class="danger-title">Zona de Perigo</div>
                  <button class="btn btn-danger ajax-button" style="width: 100%;" data-endpoint="/admin/queues/delete-all" data-confirm="Tem certeza que deseja deletar TODAS as filas do Discord e do sistema?">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3,6 5,6 21,6"/>
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                    Deletar Todas as Filas
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Queues Section -->
      <div id="section-queues" class="section">
        <div class="content-grid">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Todas as Filas</div>
                <div class="card-subtitle">Gerencie as filas de partidas</div>
              </div>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Modo</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                    <th>Canal</th>
                    <th>Jogadores</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="queues-table-body">
                  ${queueRows || `
                    <tr id="empty-queues">
                      <td colspan="6">
                        <div class="empty-state">
                          <div class="empty-state-icon">📭</div>
                          <p>Nenhuma fila cadastrada ainda</p>
                        </div>
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Nova Fila</div>
                <div class="card-subtitle">Criar nova fila de partidas</div>
              </div>
            </div>
            <div class="card-body">
              <form class="ajax-form" method="post" action="/admin/queues">
                <div class="form-group">
                  <label class="form-label">Modalidade</label>
                  <select name="mode" class="form-control" required>
                    <option value="">Selecione...</option>
                    <option value="mobile">Mobile</option>
                    <option value="emulador">Emulador</option>
                    <option value="tatico">Tático</option>
                    <option value="misto">Misto</option>
                  </select>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Tipo</label>
                  <select name="type" class="form-control" required>
                    <option value="">Selecione...</option>
                    <option value="1v1">1v1</option>
                    <option value="2v2">2v2</option>
                    <option value="3v3">3v3</option>
                    <option value="4v4">4v4</option>
                  </select>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Canal</label>
                  <input type="text" class="form-control select-search" placeholder="🔍 Pesquisar canal..." data-target="channelId" style="margin-bottom: 8px; height: 32px; font-size: 13px;">
                  <select name="channelId" id="channelId" class="form-control" required>
                    <option value="">Selecione...</option>
                    ${textChannels.map((channel) => `<option value="${channel.id}">#${escapeHtml(channel.name)}</option>`).join('')}
                  </select>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Valores (separados por vírgula)</label>
                  <input type="text" name="values" class="form-control" placeholder="5, 10, 20, 50" required>
                </div>
                
                <button type="submit" class="btn btn-primary" style="width: 100%;">
                  Criar Fila(s)
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <!-- Mediators Section -->
      <div id="section-mediators" class="section">
        <div class="content-grid">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Mediadores</div>
                <div class="card-subtitle">Lista de mediadores cadastrados</div>
              </div>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Status</th>
                    <th>Chave Pix</th>
                  </tr>
                </thead>
                <tbody>
                  ${mediatorRows || `
                    <tr>
                      <td colspan="3">
                        <div class="empty-state">
                          <div class="empty-state-icon">👤</div>
                          <p>Nenhum mediador cadastrado</p>
                        </div>
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Configuração</div>
                <div class="card-subtitle">Definir cargo e canal</div>
              </div>
            </div>
            <div class="card-body">
              <form class="ajax-form" method="post" action="/admin/mediators">
                <div class="form-group">
                  <label class="form-label">Cargo de Mediador</label>
                  <input type="text" class="form-control select-search" placeholder="🔍 Pesquisar cargo..." data-target="mediatorRole" style="margin-bottom: 8px; height: 32px; font-size: 13px;">
                  <select name="mediatorRole" id="mediatorRole" class="form-control" required>
                    <option value="">Selecione...</option>
                    ${roles.map((role) => `<option value="${role.id}" ${config.mediatorRole === role.id ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('')}
                  </select>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Canal do Painel</label>
                  <input type="text" class="form-control select-search" placeholder="🔍 Pesquisar canal..." data-target="mediatorChannel" style="margin-bottom: 8px; height: 32px; font-size: 13px;">
                  <select name="mediatorChannel" id="mediatorChannel" class="form-control" required>
                    <option value="">Selecione...</option>
                    ${textChannels.map((channel) => `<option value="${channel.id}" ${config.mediatorChannel === channel.id ? 'selected' : ''}>#${escapeHtml(channel.name)}</option>`).join('')}
                  </select>
                </div>
                
                <button type="submit" class="btn btn-primary" style="width: 100%;">
                  Salvar e Recriar Painel
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <!-- Embeds Section -->
      <div id="section-embeds" class="section">
        <div class="content-grid">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Embed das Filas</div>
                <div class="card-subtitle">Personalize a aparência das filas</div>
              </div>
            </div>
            <div class="card-body">
              <form class="ajax-form" method="post" action="/admin/embed-settings/queue">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Cor (hex)</label>
                    <input type="text" name="color" class="form-control" placeholder="#6366f1" value="${escapeHtml(queueStyle.color || '')}">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Título</label>
                    <input type="text" name="title" class="form-control" placeholder="{mode} • {type}" value="${escapeHtml(queueStyle.title || '')}">
                  </div>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Descrição</label>
                  <textarea name="description" class="form-control" placeholder="Use {mode}, {type}, {value}, {players}, {playerCount}">${escapeHtml(queueStyle.description || '')}</textarea>
                  <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Variáveis disponíveis: <code>{mode}</code>, <code>{type}</code>, <code>{value}</code>, <code>{players}</code>, <code>{playerCount}</code></p>
                </div>
                
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Thumbnail URL</label>
                    <input type="text" name="thumbnail" class="form-control" placeholder="https://..." value="${escapeHtml(queueStyle.thumbnail || '')}">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Imagem URL</label>
                    <input type="text" name="image" class="form-control" placeholder="https://..." value="${escapeHtml(queueStyle.image || '')}">
                  </div>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Footer</label>
                  <input type="text" name="footer" class="form-control" placeholder="Texto do rodapé" value="${escapeHtml(queueStyle.footer || '')}">
                </div>
                
                <button type="submit" class="btn btn-primary">
                  Salvar Estilo das Filas
                </button>
              </form>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Painel de Mediadores</div>
                <div class="card-subtitle">Personalize a embed do painel</div>
              </div>
            </div>
            <div class="card-body">
              <form class="ajax-form" method="post" action="/admin/embed-settings/mediator">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Cor (hex)</label>
                    <input type="text" name="color" class="form-control" placeholder="#3b82f6" value="${escapeHtml(mediatorStyle.color || '')}">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Título</label>
                    <input type="text" name="title" class="form-control" placeholder="Painel de Mediadores" value="${escapeHtml(mediatorStyle.title || '')}">
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label">Descrição</label>
                  <textarea name="description" class="form-control" placeholder="Use {mediators} para listar os mediadores online.">${escapeHtml(mediatorStyle.description || '')}</textarea>
                   <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Variáveis disponíveis: <code>{mediators}</code></p>
                </div>

                <div class="form-group">
                  <label class="form-label">Thumbnail URL</label>
                  <input type="text" name="thumbnail" class="form-control" placeholder="https://..." value="${escapeHtml(mediatorStyle.thumbnail || '')}">
                </div>

                <div class="form-group">
                  <label class="form-label">Footer</label>
                  <input type="text" name="footer" class="form-control" placeholder="Texto do rodapé" value="${escapeHtml(mediatorStyle.footer || '')}">
                </div>

                <button type="submit" class="btn btn-primary">
                  Salvar Aparência do Painel
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Navigation
    function showSection(sectionName) {
      // Hide all sections
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      
      // Show target section
      document.getElementById('section-' + sectionName).classList.add('active');
      
      // Update nav
      event.target.closest('.nav-item')?.classList.add('active');
      
      // Update header title
      const titles = {
        'dashboard': 'Dashboard',
        'queues': 'Gerenciamento de Filas',
        'mediators': 'Mediadores',
        'embeds': 'Aparência'
      };
      document.querySelector('.header-content h2').textContent = titles[sectionName];
    }

    // Alert system
    function showAlert(message, isError = false) {
      const container = document.getElementById('alert-container');
      const alert = document.createElement('div');
      alert.className = 'alert ' + (isError ? 'alert-error' : 'alert-success');
      alert.innerHTML = \`
        <div class="alert-icon">\${isError ? '!' : '✓'}</div>
        <div>\${message}</div>
      \`;
      
      container.appendChild(alert);
      
      // Trigger animation
      setTimeout(() => alert.classList.add('show'), 10);
      
      // Remove after delay
      setTimeout(() => {
        alert.classList.remove('show');
        setTimeout(() => alert.remove(), 300);
      }, 4000);
    }

    // Form handling
    document.querySelectorAll('.ajax-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('button[type="submit"]');
        const originalText = submit.textContent;
        
        submit.disabled = true;
        submit.textContent = 'Salvando...';

        try {
          const response = await fetch(form.action, {
            method: form.method || 'POST',
            headers: { 'x-requested-with': 'fetch', 'Accept': 'application/json' },
            body: new URLSearchParams(new FormData(form))
          });

          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Falha ao salvar.');

          showAlert(payload.message, false);
          
          if (form.action.endsWith('/admin/queues')) {
            setTimeout(() => window.location.reload(), 800);
          }
        } catch (error) {
          showAlert(error.message, true);
        } finally {
          submit.disabled = false;
          submit.textContent = originalText;
        }
      });
    });

    // Button handling
    document.querySelectorAll('.ajax-button').forEach((button) => {
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        
        const confirmMessage = button.dataset.confirm;
        if (confirmMessage && !window.confirm(confirmMessage)) {
          return;
        }

        button.disabled = true;
        const originalContent = button.innerHTML;
        button.innerHTML = '<span style="opacity: 0.5;">⏳</span>';

        try {
          const body = new URLSearchParams();
          if (button.dataset.queueId) {
            body.set('queueId', button.dataset.queueId);
          }

          const response = await fetch(button.dataset.endpoint, {
            method: 'POST',
            headers: { 'x-requested-with': 'fetch', 'Accept': 'application/json' },
            body
          });

          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Falha ao executar ação.');

          showAlert(payload.message, false);

          if (button.dataset.queueId) {
              const row = document.getElementById('queue-row-' + CSS.escape(button.dataset.queueId));
              if (row) {
                row.style.opacity = '0';
                setTimeout(() => row.remove(), 300);
              }
              const rowDash = document.getElementById('queue-row-dash-' + CSS.escape(button.dataset.queueId));
              if (rowDash) {
                rowDash.style.opacity = '0';
                setTimeout(() => rowDash.remove(), 300);
              }
              setTimeout(() => {
                syncEmptyState();
                updateStats();
              }, 300);
          } else if (button.dataset.endpoint.endsWith('/delete-all')) {
            document.querySelectorAll('tr[id^="queue-row-"]').forEach(row => {
              row.style.opacity = '0';
              setTimeout(() => row.remove(), 300);
            });
            document.querySelectorAll('tr[id^="queue-row-dash-"]').forEach(row => {
              row.style.opacity = '0';
              setTimeout(() => row.remove(), 300);
            });
            setTimeout(() => {
              syncEmptyState();
              updateStats();
            }, 300);
          }
        } catch (error) {
          showAlert(error.message, true);
        } finally {
          button.disabled = false;
          button.innerHTML = originalContent;
        }
      });
    });

    function syncEmptyState() {
      const tbodies = [
        document.getElementById('queues-table-body'),
        document.getElementById('dashboard-queues-table-body')
      ];
      
      tbodies.forEach(tbody => {
        if (!tbody) return;
        const rows = tbody.querySelectorAll('tr[id^="queue-row-"]');
        const isEmpty = tbody.querySelector('.empty-state');
        
        if (rows.length === 0 && !isEmpty) {
          const cols = tbody.id === 'dashboard-queues-table-body' ? 5 : 6;
          tbody.innerHTML = \`
            <tr class="empty-row">
              <td colspan="\${cols}">
                <div class="empty-state">
                  <div class="empty-state-icon">📭</div>
                  <p>Nenhuma fila cadastrada ainda</p>
                </div>
              </td>
            </tr>
          \`;
        }
      });
    }

    function updateStats() {
      const count = document.querySelectorAll('#queues-table-body tr[id^="queue-row-"]').length;
      const statQueues = document.getElementById('stat-queues');
      if (statQueues) statQueues.textContent = count;
      
      const statVolume = document.getElementById('stat-volume');
      if (statVolume) {
        if (count === 0) statVolume.textContent = '0';
      }
    }

    // Initial status message
    const statusMessage = '${escapeHtml(status || '')}';
    if (statusMessage) {
      showAlert(statusMessage, false);
    }

    // Select search functionality
    document.querySelectorAll('.select-search').forEach(input => {
      input.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const targetId = e.target.dataset.target;
        const select = document.getElementById(targetId);
        
        if (!select) return;

        const options = select.options;
        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          if (!option.value) continue; // Skip placeholder

          const text = option.textContent.toLowerCase();
          const matches = text.includes(searchTerm);
          
          if (matches) {
            option.style.display = 'block';
          } else {
            option.style.display = 'none';
          }
        }
      });
    });
  </script>
</body>
</html>`;
}

function renderError(error) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Erro | Painel Admin</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0a0a0f;
      color: #fff;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .error-container {
      text-align: center;
      padding: 40px;
    }
    .error-code {
      font-size: 120px;
      font-weight: 900;
      background: linear-gradient(135deg, #6366f1, #ef4444);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 24px;
      margin-bottom: 16px;
    }
    pre {
      background: #12121a;
      padding: 20px;
      border-radius: 12px;
      text-align: left;
      overflow-x: auto;
      font-size: 13px;
      color: #ef4444;
      max-width: 800px;
      border: 1px solid #2a2a3a;
    }
    .back {
      display: inline-block;
      margin-top: 24px;
      padding: 12px 24px;
      background: #6366f1;
      color: white;
      text-decoration: none;
      border-radius: 8px;F
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-code">500</div>
    <h1>Erro no painel</h1>
    <pre>${escapeHtml(error.stack || error.message || String(error))}</pre>
    <a href="/admin" class="back">Voltar ao painel</a>
  </div>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

module.exports = { startAdminPanel };

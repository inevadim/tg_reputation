require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Визуальные ранги с эмодзи
const rankLevels = [
  { name: 'E', min: 0, max: 9, emoji: '🟤' },
  { name: 'D', min: 10, max: 19, emoji: '🟣' },
  { name: 'C', min: 20, max: 29, emoji: '🔵' },
  { name: 'B', min: 30, max: 39, emoji: '🟢' },
  { name: 'A', min: 40, max: 49, emoji: '🟡' },
  { name: 'S', min: 50, max: 59, emoji: '🟠' },
  { name: 'S+', min: 60, max: 69, emoji: '🔴' },
  { name: 'NATIONAL LEVEL', min: 70, max: 79, emoji: '🌐' },
  { name: 'SHADOW MONARCH', min: 80, max: 1000, emoji: '👑' }
];

// 🎖 Определение ранга по очкам
function getRank(points) {
  return rankLevels.find(r => points >= r.min && points <= r.max);
}

// 🏆 Достижения
function getAchievements(points) {
  const medals = [];
  if (points >= 10) medals.push('🥉');
  if (points >= 30) medals.push('🥈');
  if (points >= 50) medals.push('🥇');
  if (points >= 80) medals.push('🏆');
  return medals.join(' ');
}

// ✅ Проверка админа
async function isAdmin(ctx) {
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return ['administrator', 'creator'].includes(member.status);
  } catch (err) {
    return false;
  }
}

// 📂 Создание таблиц при запуске
async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username TEXT,
      points INT DEFAULT 0,
      rank TEXT DEFAULT 'E'
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      from_id BIGINT,
      to_id BIGINT,
      action TEXT,
      date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
initTables();

// 🧩 /vozroditsya — регистрация
bot.command('vozroditsya', async (ctx) => {
  const id = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;

  const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  if (res.rows.length) {
    ctx.reply('Вы уже зарегистрированы!');
  } else {
    await pool.query('INSERT INTO users (id, username) VALUES ($1, $2)', [id, username]);
    ctx.reply('✅ Вы успешно зарегистрированы!');
  }
});

// 📊 /status
bot.command('status', async (ctx) => {
  const id = ctx.from.id;
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);

  if (res.rows.length === 0) return ctx.reply('Вы не зарегистрированы. Используйте /vozroditsya');

  const user = res.rows[0];
  const rankObj = getRank(user.points);
  const achievements = getAchievements(user.points);

  ctx.reply(`📊 Ваш статус:
👤 Пользователь: @${user.username}
🎯 Очки: ${user.points}
🎖 Ранг: ${rankObj.emoji} ${rankObj.name}
🏆 Достижения: ${achievements || '—'}`);
});

// 🏆 /top
bot.command('top', async (ctx) => {
  const res = await pool.query('SELECT * FROM users ORDER BY points DESC LIMIT 10');
  const lines = res.rows.map((u, i) => {
    const rankObj = getRank(u.points);
    const achievements = getAchievements(u.points);
    return `${i + 1}. @${u.username} — ${u.points} очков ${rankObj.emoji} ${rankObj.name} ${achievements}`;
  });

  ctx.reply(`🏆 Топ пользователей:\n\n${lines.join('\n')}`);
});

// 📋 /info
bot.command('info', (ctx) => {
  ctx.reply(`
📘 Доступные команды:

👤 /me — ваш Telegram ID
📊 /status — ваш статус
🧬 /vozroditsya — регистрация
🏆 /top — топ пользователей
ℹ️ /info — список всех команд

🔧 Админ-команды:
➕ /rep <id> — добавить репутацию
➖ /unrep <id> — отнять репутацию
🗑 /delete <id> — удалить пользователя
🛠 /rangedit <id> <очки> — задать очки вручную
📋 /log — история действий
  `);
});

// 👤 /me
bot.command('me', (ctx) => {
  ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`);
});

// ➕ /rep
bot.command('rep', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const targetId = parts[1];
  if (!await isAdmin(ctx)) return ctx.reply('⛔️ Нет доступа');

  const user = await pool.query('SELECT * FROM users WHERE id = $1', [targetId]);
  if (user.rows.length === 0) return ctx.reply('Пользователь не найден.');

  const oldRank = getRank(user.rows[0].points).name;
  const newPoints = user.rows[0].points + 1;

  await pool.query('UPDATE users SET points = $1 WHERE id = $2', [newPoints, targetId]);
  await pool.query('INSERT INTO logs (from_id, to_id, action) VALUES ($1, $2, $3)', [ctx.from.id, targetId, 'rep']);

  const newRank = getRank(newPoints).name;
  if (newRank !== oldRank) {
    ctx.reply(`🎉 Пользователь получил новый ранг: ${getRank(newPoints).emoji} ${newRank}`);
  }

  ctx.reply('Репутация добавлена.');
});

// ➖ /unrep
bot.command('unrep', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const targetId = parts[1];
  if (!await isAdmin(ctx)) return ctx.reply('⛔️ Нет доступа');

  const user = await pool.query('SELECT * FROM users WHERE id = $1', [targetId]);
  if (user.rows.length === 0) return ctx.reply('Пользователь не найден.');

  const oldRank = getRank(user.rows[0].points).name;
  const newPoints = Math.max(user.rows[0].points - 1, 0);

  await pool.query('UPDATE users SET points = $1 WHERE id = $2', [newPoints, targetId]);
  await pool.query('INSERT INTO logs (from_id, to_id, action) VALUES ($1, $2, $3)', [ctx.from.id, targetId, 'unrep']);

  const newRank = getRank(newPoints).name;
  if (newRank !== oldRank) {
    ctx.reply(`⚠️ Пользователь понижен до ранга: ${getRank(newPoints).emoji} ${newRank}`);
  }

  ctx.reply('Репутация уменьшена.');
});

// 🎯 /rangedit
bot.command('rangedit', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('⛔️ Нет доступа');
  const [_, id, value] = ctx.message.text.split(' ');

  if (!id || !value) return ctx.reply('Формат: /rangedit <id> <очки>');

  await pool.query('UPDATE users SET points = $1 WHERE id = $2', [parseInt(value), id]);
  ctx.reply(`✅ Очки пользователя обновлены до ${value}`);
});

// 🗑 /delete
bot.command('delete', async (ctx) => {
  const id = ctx.message.text.split(' ')[1];
  if (!await isAdmin(ctx)) return ctx.reply('⛔️ Нет доступа');

  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  await pool.query('INSERT INTO logs (from_id, to_id, action) VALUES ($1, $2, $3)', [ctx.from.id, id, 'delete']);
  ctx.reply('Пользователь удалён.');
});

// 🗃 /log
bot.command('log', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('⛔️ Нет доступа');
  const res = await pool.query('SELECT * FROM logs ORDER BY date DESC LIMIT 10');

  const lines = await Promise.all(res.rows.map(async (l) => {
    const from = (await bot.telegram.getChat(l.from_id)).username || l.from_id;
    const to = (await bot.telegram.getChat(l.to_id)).username || l.to_id;
    return `${l.date.toLocaleString()} — ${from} → ${to} (${l.action})`;
  }));

  ctx.reply(`📋 Последние действия:\n\n${lines.join('\n')}`);
});

bot.launch();

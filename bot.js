require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Бот работает!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Сервер запущен на порту ${PORT}`));

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 🏅 Ранговая система с эмодзи
const rankList = [
  { min: 0, max: 9, name: 'E', emoji: '🔸' },
  { min: 10, max: 19, name: 'D', emoji: '🔹' },
  { min: 20, max: 29, name: 'C', emoji: '🟢' },
  { min: 30, max: 39, name: 'B', emoji: '🔵' },
  { min: 40, max: 49, name: 'A', emoji: '🟣' },
  { min: 50, max: 59, name: 'S', emoji: '🔥' },
  { min: 60, max: 69, name: 'S+', emoji: '💎' },
  { min: 70, max: 79, name: 'NATIONAL LEVEL', emoji: '🌍' },
  { min: 80, max: 1000, name: 'SHADOW MONARCH', emoji: '👑' },
];

function getRank(rep) {
  return rankList.find(r => rep >= r.min && rep <= r.max);
}

// 🎖 Простейшая система достижений
function getAchievements(rep) {
  const achievements = [];
  if (rep >= 10) achievements.push('🥉 Первое повышение');
  if (rep >= 30) achievements.push('🥈 Продвинутый');
  if (rep >= 50) achievements.push('🥇 Легенда');
  if (rep >= 80) achievements.push('🏆 Тень Монарха');
  return achievements;
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT,
        tg_id BIGINT UNIQUE NOT NULL,
        rep INTEGER DEFAULT 0
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        action TEXT,
        target_id BIGINT,
        actor_id BIGINT,
        timestamp TIMESTAMP DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
})();

async function isAdmin(ctx) {
  try {
    const status = await ctx.getChatMember(ctx.from.id);
    return ['administrator', 'creator'].includes(status.status);
  } catch {
    return false;
  }
}

async function updateRep(ctx, tg_id, delta) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT rep FROM users WHERE tg_id = $1', [tg_id]);
    if (res.rowCount === 0) return ctx.reply('Пользователь не найден.');
    const oldRep = res.rows[0].rep;
    const oldRank = getRank(oldRep);

    const newRes = await client.query(
      'UPDATE users SET rep = rep + $1 WHERE tg_id = $2 RETURNING rep',
      [delta, tg_id]
    );
    const newRep = newRes.rows[0].rep;
    const newRank = getRank(newRep);

    if (oldRank.name !== newRank.name) {
      await ctx.reply(`🎉 Новый ранг: ${newRank.emoji} ${newRank.name}`);
    }

    await client.query(
      'INSERT INTO logs (action, target_id, actor_id) VALUES ($1, $2, $3)',
      [delta > 0 ? 'rep' : 'unrep', tg_id, ctx.from.id]
    );

    ctx.reply(`Обновлено: Репутация пользователя ${tg_id} теперь ${newRep}`);
  } finally {
    client.release();
  }
}

bot.command('vozroditsya', async (ctx) => {
  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT * FROM users WHERE tg_id = $1', [ctx.from.id]);
    if (existing.rowCount > 0) return ctx.reply('Вы уже зарегистрированы.');

    await client.query(
      'INSERT INTO users (name, tg_id) VALUES ($1, $2)',
      [ctx.from.username, ctx.from.id]
    );
    ctx.reply('🎉 Регистрация прошла успешно!');
  } finally {
    client.release();
  }
});

bot.command('status', async (ctx) => {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT rep FROM users WHERE tg_id = $1', [ctx.from.id]);
    if (res.rowCount === 0) return ctx.reply('Сначала зарегистрируйтесь через /vozroditsya');
    const rep = res.rows[0].rep;
    const rank = getRank(rep);
    const achievements = getAchievements(rep).join('\n') || '—';

    ctx.reply(`📊 Репутация: ${rep}\n🏅 Ранг: ${rank.emoji} ${rank.name}\n🎯 Достижения:\n${achievements}`);
  } finally {
    client.release();
  }
});

bot.command('me', async (ctx) => {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM users WHERE tg_id = $1', [ctx.from.id]);
    if (res.rowCount === 0) return ctx.reply('Вы не зарегистрированы.');
    const user = res.rows[0];
    const rank = getRank(user.rep);
    const achievements = getAchievements(user.rep).join('\n') || '—';

    ctx.reply(`🧍‍♂️ Имя: ${user.name}\nID: ${user.tg_id}\nОчки: ${user.rep}\nРанг: ${rank.emoji} ${rank.name}\n🎯 Достижения:\n${achievements}`);
  } finally {
    client.release();
  }
});

bot.command('rep', async (ctx) => {
  if (!(await isAdmin(ctx))) return ctx.reply('⛔ Только админы!');
  const [, id] = ctx.message.text.split(' ');
  if (!id) return ctx.reply('Укажи ID');
  updateRep(ctx, id, 1);
});

bot.command('unrep', async (ctx) => {
  if (!(await isAdmin(ctx))) return ctx.reply('⛔ Только админы!');
  const [, id] = ctx.message.text.split(' ');
  if (!id) return ctx.reply('Укажи ID');
  updateRep(ctx, id, -1);
});

bot.command('rangedit', async (ctx) => {
  if (!(await isAdmin(ctx))) return ctx.reply('⛔ Только админы!');
  const [, id, value] = ctx.message.text.split(' ');
  if (!id || !value || isNaN(value)) return ctx.reply('Формат: /rangedit <tg_id> <очки>');

  const client = await pool.connect();
  try {
    const old = await client.query('SELECT rep FROM users WHERE tg_id = $1', [id]);
    if (old.rowCount === 0) return ctx.reply('Пользователь не найден.');
    const oldRank = getRank(old.rows[0].rep);

    await client.query('UPDATE users SET rep = $1 WHERE tg_id = $2', [value, id]);
    const newRank = getRank(Number(value));
    if (oldRank.name !== newRank.name) {
      await ctx.reply(`🎉 Новый ранг: ${newRank.emoji} ${newRank.name}`);
    }

    ctx.reply(`✅ Установлено ${value} очков пользователю ${id}`);
  } finally {
    client.release();
  }
});

// 🧪 /test
bot.command('test', async (ctx) => {
  try {
    await pool.query('SELECT NOW()');
    ctx.reply('✅ БД работает');
  } catch {
    ctx.reply('❌ Ошибка подключения к БД');
  }
});

// 💬 Реплай: plus / minus
bot.on('text', async (ctx) => {
  if (!await isAdmin(ctx)) return;
  const reply = ctx.message.reply_to_message;
  if (!reply) return;

  const text = ctx.message.text.toLowerCase();
  const targetId = reply.from.id;
  const userCheck = await pool.query('SELECT * FROM users WHERE tg_id = $1', [targetId]);
  if (userCheck.rowCount === 0) return;

  if (text === 'plus') {
    ctx.state.command = { raw: `/rep ${targetId}` };
    ctx.message.text = `/rep ${targetId}`;
    bot.handleUpdate(ctx.update);
  } else if (text === 'minus') {
    ctx.state.command = { raw: `/unrep ${targetId}` };
    ctx.message.text = `/unrep ${targetId}`;
    bot.handleUpdate(ctx.update);
  }
});



// 📋 /bd
bot.command('bd', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('Только админ.');
  const res = await pool.query('SELECT * FROM users ORDER BY id');
  if (res.rowCount === 0) return ctx.reply('Пользователи не найдены.');
  const users = res.rows.map(u => `${u.name} (${u.tg_id}) — Реп: ${u.rep}`).join('\n');
  ctx.reply('📋 Список пользователей:\n' + users);
});

// 🧾 /log
bot.command('log', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('Только админ.');
  const res = await pool.query('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10');
  if (res.rowCount === 0) return ctx.reply('Пока лог пуст.');
  const logs = res.rows.map(log => `• ${log.action} — Target: ${log.target_id}, By: ${log.actor_id}, Время: ${log.timestamp.toLocaleString()}`).join('\n');
  ctx.reply('📋 Последние действия:\n' + logs);
});


bot.command('top', async (ctx) => {
  const res = await pool.query('SELECT * FROM users ORDER BY rep DESC LIMIT 10');
  if (res.rowCount === 0) return ctx.reply('Нет данных.');
  let msg = '🏆 Топ пользователей:\n\n';
  res.rows.forEach((u, i) => {
    const rank = getRank(u.rep);
    msg += `${i + 1}. ${u.name} — ${u.rep} очков (${rank.emoji} ${rank.name})\n`;
  });
  ctx.reply(msg);
});

bot.command('info', (ctx) => {
  ctx.reply(`
📘 Команды:

👤 /me — информация
👥 /vozroditsya — регистрация
📊 /status — статус и достижения
🏆 /top — топ пользователей

🔧 Админ-команды:
🧩 /vostat <id> — вручную добавить пользователя
➕ /rep <tg_id>
➖ /unrep <tg_id>
🗑 /delete <tg_id> — удалить пользователя
📋 /bd — список пользователей
📜 /log — последние действия
📏 /rangedit <tg_id> <очки>
🧪 /test — тест БД
ℹ️ /info — команды
  `);
});



bot.launch();
console.log('✅ Бот запущен');

require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// ✅ Автосоздание таблиц при запуске
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
    console.log('✅ Таблицы users и logs проверены/созданы');
  } catch (err) {
    console.error('❌ Ошибка при создании таблиц', err);
  } finally {
    client.release();
  }
})();

// 🔐 Проверка на администратора
async function isAdmin(ctx) {
  const userId = ctx.from.id;
  const chatMember = await ctx.getChatMember(userId);
  return ['administrator', 'creator'].includes(chatMember.status);
}

// 👥 /vozroditsya — регистрация
bot.command('vozroditsya', async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.username;

  const client = await pool.connect();
  try {
    const check = await client.query('SELECT * FROM users WHERE tg_id = $1', [userId]);
    if (check.rowCount > 0) {
      return ctx.reply('Вы уже зарегистрированы.');
    }

    await client.query('INSERT INTO users (name, tg_id, rep) VALUES ($1, $2, 0)', [userName, userId]);
    ctx.reply(`Вы успешно возродились! Ваш ID: ${userId}`);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при регистрации.');
  } finally {
    client.release();
  }
});

// 📊 /status — статус с рангом
bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  const client = await pool.connect();

  try {
    const res = await client.query('SELECT rep FROM users WHERE tg_id = $1', [userId]);
    if (res.rowCount === 0) {
      return ctx.reply('Вы не зарегистрированы. Используйте /vozroditsya');
    }

    const rep = res.rows[0].rep;
    let rank = 'Новичок';
    if (rep >= 10) rank = 'Легенда';
    else if (rep >= 5) rank = 'Активный';

    ctx.reply(`📊 Ваша репутация: ${rep}\n🏅 Ранг: ${rank}`);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при получении статуса.');
  } finally {
    client.release();
  }
});

// 👤 /me — информация о себе
bot.command('me', async (ctx) => {
  const userId = ctx.from.id;
  const client = await pool.connect();

  try {
    const res = await client.query('SELECT * FROM users WHERE tg_id = $1', [userId]);
    if (res.rowCount === 0) return ctx.reply('Вы не зарегистрированы.');

    const user = res.rows[0];
    ctx.reply(`🧍‍♂️ Вы:\nID в БД: ${user.id}\nTelegram ID: ${user.tg_id}\nИмя: ${user.name}\nРепутация: ${user.rep}`);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при получении данных.');
  } finally {
    client.release();
  }
});

// ➕ /rep <tg_id>
bot.command('rep', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('Только админы могут использовать эту команду.');
  const args = ctx.message.text.split(' ');
  const tg_id = args[1];

  if (!tg_id) return ctx.reply('Укажите ID пользователя (tg_id).');

  try {
    const res = await pool.query('UPDATE users SET rep = rep + 1 WHERE tg_id = $1 RETURNING *', [tg_id]);
    if (res.rowCount === 0) return ctx.reply('Пользователь не найден.');

    await pool.query('INSERT INTO logs (action, target_id, actor_id) VALUES ($1, $2, $3)', ['rep', tg_id, ctx.from.id]);

    ctx.reply(`✅ Репутация пользователя ${tg_id} увеличена. Сейчас: ${res.rows[0].rep}`);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при выполнении.');
  }
});

// ➖ /unrep <tg_id>
bot.command('unrep', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('Только админы могут использовать эту команду.');
  const args = ctx.message.text.split(' ');
  const tg_id = args[1];

  if (!tg_id) return ctx.reply('Укажите ID пользователя (tg_id).');

  try {
    const res = await pool.query('SELECT rep FROM users WHERE tg_id = $1', [tg_id]);
    if (res.rowCount === 0) return ctx.reply('Пользователь не найден.');
    if (res.rows[0].rep <= 0) return ctx.reply('Репутация уже 0.');

    const updated = await pool.query('UPDATE users SET rep = rep - 1 WHERE tg_id = $1 RETURNING *', [tg_id]);
    await pool.query('INSERT INTO logs (action, target_id, actor_id) VALUES ($1, $2, $3)', ['unrep', tg_id, ctx.from.id]);

    ctx.reply(`➖ Репутация понижена. Сейчас: ${updated.rows[0].rep}`);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при выполнении.');
  }
});

// 🗑 /delete <tg_id>
bot.command('delete', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('Только админы могут использовать эту команду.');
  const args = ctx.message.text.split(' ');
  const tg_id = args[1];

  if (!tg_id) return ctx.reply('Укажите ID пользователя (tg_id).');

  try {
    const res = await pool.query('DELETE FROM users WHERE tg_id = $1 RETURNING *', [tg_id]);
    if (res.rowCount === 0) return ctx.reply('Пользователь не найден.');

    await pool.query('INSERT INTO logs (action, target_id, actor_id) VALUES ($1, $2, $3)', ['delete', tg_id, ctx.from.id]);

    ctx.reply(`🗑 Пользователь ${tg_id} удалён.`);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при удалении.');
  }
});

// 📋 /bd — список пользователей
bot.command('bd', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('Только админы могут использовать эту команду.');

  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM users');
    if (result.rowCount === 0) return ctx.reply('Нет пользователей.');

    let msg = '📋 Список пользователей:\n\n';
    result.rows.forEach(user => {
      msg += `ID: ${user.id}, Имя: ${user.name}, TG ID: ${user.tg_id}, Репутация: ${user.rep}\n`;
    });

    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при выводе.');
  } finally {
    client.release();
  }
});

// 📜 /log — последние действия
bot.command('log', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply('Только админы могут использовать эту команду.');

  try {
    const res = await pool.query('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10');
    if (res.rowCount === 0) return ctx.reply('Лог пуст.');

    let msg = '🕓 Последние действия:\n';
    res.rows.forEach(log => {
      msg += `• ${log.action.toUpperCase()} | Target: ${log.target_id}, By: ${log.actor_id}, Время: ${log.timestamp.toLocaleString()}\n`;
    });

    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при загрузке лога.');
  }
});

// 🏆 /top — рейтинг
bot.command('top', async (ctx) => {
  try {
    const res = await pool.query('SELECT * FROM users ORDER BY rep DESC LIMIT 10');
    if (res.rowCount === 0) return ctx.reply('Пока пусто.');

    let msg = '🏆 Топ пользователей:\n\n';
    res.rows.forEach((user, i) => {
      msg += `${i + 1}. ${user.name} — ${user.rep} очков\n`;
    });

    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка при получении топа.');
  }
});

// ℹ️ /info — справка
bot.command('info', (ctx) => {
  ctx.reply(`
📘 Команды:

👤 /me — показать информацию о себе
👥 /vozroditsya — зарегистрироваться
📊 /status — ваша репутация и ранг

🔧 Админ-команды:
🧩 /vostat <id> — вручную добавить пользователя
➕ /rep <tg_id> — повысить репутацию
➖ /unrep <tg_id> — понизить репутацию
🗑 /delete <tg_id> — удалить пользователя
📋 /bd — список пользователей
📜 /log — последние действия
🏆 /top — топ пользователей
🧪 /test — тест БД
ℹ️ /info — команды
  `);
});

// 🧪 /test — проверка БД
bot.command('test', async (ctx) => {
  try {
    await pool.query('SELECT NOW()');
    ctx.reply('✅ Подключение к базе данных работает.');
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Ошибка подключения к базе.');
  }
});

bot.launch();
console.log('✅ Бот запущен');

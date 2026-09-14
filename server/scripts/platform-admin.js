#!/usr/bin/env node
// Offline administrator bootstrap only. No dotenv/default database, no passwords
// in argv or output. JSON input is read from a pipe or an owner-only 0600 file.
//   node scripts/platform-admin.js create --stdin
//   node scripts/platform-admin.js reset-password --file /private/parameters.json
// create JSON: {username, displayName, password}; reset JSON: {username, password}
const fs = require('node:fs');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const MAX_INPUT = 16 * 1024;
const usage = '用法：platform-admin.js create|reset-password --stdin 或 --file /私有/参数.json；密码只放JSON输入，不放命令行。';
const error = message => Object.assign(new Error(message), { safeToPrint: true });
const username = z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/);
const password = z.string().min(12).refine(value => Buffer.byteLength(value, 'utf8') <= 72);
const schema = {
  create: z.object({ username, displayName: z.string().trim().min(1).max(64), password }).strict(),
  'reset-password': z.object({ username, password }).strict(),
};

function readPrivateFile(filename) {
  let fd;
  try {
    // Reject symlinks at open time, then validate the same descriptor read below.
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const info = fs.fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o777) !== 0o600
        || (process.getuid && info.uid !== process.getuid()) || info.size > MAX_INPUT) {
      throw error('参数文件必须是当前用户持有的0600普通文件，且不超过16KB');
    }
    const buffer = Buffer.alloc(MAX_INPUT + 1);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (count > MAX_INPUT) throw error('参数输入不得超过16KB');
    return buffer.subarray(0, count).toString('utf8');
  } catch (e) {
    if (e.safeToPrint) throw e;
    throw error('无法安全读取参数文件：请使用本人持有的0600普通文件，不接受符号链接');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
async function readInput(args) {
  if (args.length === 2 && args[0] === '--file') return readPrivateFile(args[1]);
  if (args.length !== 1 || args[0] !== '--stdin') throw error(usage);
  if (process.stdin.isTTY) throw error('请通过标准输入管道提供JSON，或使用0600参数文件；不在终端回显输入密码');
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > MAX_INPUT) throw error('参数输入不得超过16KB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  // Check before importing Prisma, so missing env can never load the default DB.
  const databaseUrl = process.env.DATABASE_URL;
  const platformKey = process.env.PLATFORM_JWT_SECRET;
  if (!databaseUrl?.trim() || !platformKey?.trim()
      || Buffer.byteLength(platformKey, 'utf8') < 32 || platformKey === process.env.JWT_SECRET) {
    throw error('必须显式配置DATABASE_URL和至少32字节且不同于JWT_SECRET的PLATFORM_JWT_SECRET；不会读取.env或使用默认库');
  }
  const [action, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(schema, action)) throw error(usage);
  let parsed;
  try { parsed = schema[action].safeParse(JSON.parse(await readInput(args))); }
  catch (e) { if (e.safeToPrint) throw e; throw error('参数必须是有效JSON，不会输出输入内容'); }
  if (!parsed.success) throw error('参数无效：用户名3–64位字母数字或_.-，密码至少12字符且最多72个UTF-8字节；创建须提供displayName');
  const data = parsed.data;
  const passwordHash = await bcrypt.hash(data.password, 12);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const admin = await db.$transaction(async tx => {
      let account;
      if (action === 'create') {
        account = await tx.platformAdmin.create({ data: {
          username: data.username, displayName: data.displayName, passwordHash,
        } });
      } else {
        // The first transaction statement is a write. Concurrent resets serialize,
        // each revokes older sessions; resetting a disabled account never enables it.
        const changed = await tx.platformAdmin.updateMany({ where: { username: data.username }, data: {
          passwordHash, sessionVersion: { increment: 1 },
        } });
        if (changed.count !== 1) throw error('平台管理员不存在；未更改任何账号');
        account = await tx.platformAdmin.findUnique({ where: { username: data.username } });
      }
      await tx.platformAudit.create({ data: {
        action: `platform.admin.${action}`, targetId: String(account.id),
        reason: 'offline administrator CLI', metadata: JSON.stringify({ source: 'offline-cli' }),
      } });
      return { id: account.id, username: account.username, displayName: account.displayName };
    });
    process.stdout.write(`${JSON.stringify({ ok: true, action, admin })}\n`);
  } catch (e) {
    if (e.safeToPrint) throw e;
    if (e.code === 'P2002') throw error('平台用户名已存在；未更改已有账号');
    throw error('平台账号操作失败，事务未完成；请核对显式数据库配置和表结构');
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module) {
  main().catch(e => {
    process.stderr.write(`${e.safeToPrint ? e.message : '平台账号操作失败，未输出敏感详情'}\n`);
    process.exitCode = 1;
  });
}
module.exports = { main };

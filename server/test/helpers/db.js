// 隔离测试库工具。
// 必须在 require('../src/config/prisma') **之前**同步调用 useIsolatedDb()——
// PrismaClient 在 require 那一刻就读走 DATABASE_URL，晚一步就连到 dev.db 上去了。
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_DIR = path.join(__dirname, '../..');

/**
 * 建一个空的隔离 SQLite 库并把 DATABASE_URL 指过去。
 * @param {string} name 库名，最终落在 /tmp/unit-<name>.db
 */
const useIsolatedDb = (name) => {
  const file = `/tmp/unit-${name}.db`;
  // -wal/-shm/-journal 一起清，残留会让"干净库"里冒出上一次的数据
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  process.env.DATABASE_URL = `file:${file}`;
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: SERVER_DIR,
    env: process.env,
    stdio: 'ignore',
  });
  return file;
};

/** 跑完删干净，不给下次留残渣 */
const dropIsolatedDb = (file) => {
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
};

/**
 * 一套最小可用的店铺基础数据（建单必需的 User / ProductType）。
 *
 * 顺带做一道保命检查：PrismaClient 在 require 那一刻就绑死了 DATABASE_URL，
 * 万一有人把 require 顺序调到了 useIsolatedDb() 前面（或被 import 排序工具挪了位），
 * 客户端会静默连到 prisma/dev.db 上，这些测试就会往真库里灌垃圾数据。
 * 干净的隔离库在当前店铺下必然 0 个用户，dev.db 不可能是——用这个差别当绊线。
 */
const seedBase = async (prisma, { username = 'tester', typeName = '白酒' } = {}) => {
  if ((await prisma.user.count()) > 0) {
    throw new Error(
      `测试库不干净：当前店铺已有用户，说明连到的多半不是隔离库而是 ${process.env.DATABASE_URL}。` +
        '请确认 useIsolatedDb() 在 require("../src/config/prisma") 之前执行。'
    );
  }
  const user = await prisma.user.create({
    data: { username, passwordHash: 'x', realName: '测试老板', role: 'admin' },
  });
  const type = await prisma.productType.create({ data: { name: typeName } });
  return { user, type };
};

/** 建一个带默认规格的商品，返回 { product, sku } */
const seedProduct = async (prisma, { typeId, name, code, price, costPrice = null, quantity = 0 }) => {
  const product = await prisma.product.create({
    data: { code, name, productTypeId: typeId, unit: '瓶', defaultPrice: price, costPrice },
  });
  const sku = await prisma.sku.create({
    data: { productId: product.id, code, price, costPrice, isDefault: 1, specText: '' },
  });
  await prisma.inventory.create({ data: { productId: product.id, skuId: sku.id, quantity } });
  return { product, sku };
};

module.exports = { useIsolatedDb, dropIsolatedDb, seedBase, seedProduct };

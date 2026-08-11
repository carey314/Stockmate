require('dotenv').config();
// 时区钉死：全部"今天/本月"边界按本地时区算。换台 UTC 机器部署也不会把
// 北京时间早上 8 点前的生意算到前一天（必须在任何 Date 使用之前设置）
process.env.TZ = process.env.TZ || 'Asia/Shanghai';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

const { globalLimiter } = require('./middlewares/rateLimit');
app.use(globalLimiter); // 全局兜底限流：客户端死循环/脚本刷接口时保住服务器
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// 健康检查：进程活着不代表服务可用——必须真查一次库。
// 只看进程存活的监控，会在"DB 文件损坏但 Node 还在跑"时给你一路绿灯。
app.get('/health', async (_req, res) => {
  const started = Date.now();
  try {
    const prisma = require('./config/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'ok', dbMs: Date.now() - started, uptimeSec: Math.round(process.uptime()), ts: Date.now() });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'fail', error: String(e).slice(0, 200), ts: Date.now() });
  }
});

// 运维体检（和 /health 分开：/health 管"服务活着吗"，这里管"运维状态健康吗"）。
// 备份失败原本只写日志——没人看的日志等于没有。做成 HTTP 状态码后，
// 任何免费的 uptime 监控（UptimeRobot 之类）指到这个地址，就等于有了备份告警。
app.get('/health/ops', async (_req, res) => {
  const fs = require('fs');
  const path = require('path');
  const warnings = [];
  const out = { ok: true, ts: Date.now() };

  try {
    const prisma = require('./config/prisma');
    await prisma.$queryRaw`SELECT 1`;
    out.db = 'ok';
  } catch (e) {
    out.db = 'fail';
    warnings.push(`数据库不可用：${String(e).slice(0, 120)}`);
  }

  // 备份新鲜度：超过 36 小时没有新备份就是出事了（正常每天 03:20 一份）
  try {
    const dir = process.env.BACKUP_DIR || '/opt/stockmate/backups';
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('prod-') && f.endsWith('.db.gz'));
    if (!files.length) {
      warnings.push('从未产生过备份');
      out.lastBackupAt = null;
    } else {
      const newest = files
        .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)[0];
      const ageH = Math.round((Date.now() - newest.m) / 36e5);
      out.lastBackupAt = new Date(newest.m).toISOString();
      out.backupAgeHours = ageH;
      out.backupCount = files.length;
      if (ageH > 36) warnings.push(`备份已 ${ageH} 小时未更新（正常每天一份）`);
    }
  } catch (e) {
    warnings.push(`读不到备份目录：${String(e).slice(0, 100)}`);
  }

  if (warnings.length) {
    out.ok = false;
    out.warnings = warnings;
    return res.status(503).json(out);
  }
  res.json(out);
});
// 商品图片。CORP 设 cross-origin：Web 管理端开发时跨源(5180→3100)加载图片会被 helmet 默认的 same-origin 拦
app.use('/uploads', require('express').static(require('path').join(__dirname, '../uploads'), {
  setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
}));
app.use('/api/v1', routes);

app.use((_req, res) => res.status(404).json({ code: 404, message: '接口不存在' }));
app.use(errorHandler);

const port = process.env.PORT || 3100;
app.listen(port, () => console.log(`[stockmate] API listening on :${port}`));

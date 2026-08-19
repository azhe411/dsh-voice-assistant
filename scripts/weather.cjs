// weather.cjs - 查天气: IP 定位城市 + 中国天气网数据
// 用法:
//   node weather.cjs            → 今天实时+预报
//   node weather.cjs 1          → 明天 (0=今天, 1=明天, 2=后天, ...)
// 输出一行中文: 元宝 多云 28度 西风2级 湿度63% 空气质量优
const https = require('https');
const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://www.weather.com.cn/' } }, (res) => {
      res.setEncoding('utf-8');
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function pickForecast(slots, dayLabel) {
  // slots: 某天的多条 "日期时间,码,天气,温度,风向,风力,降水" 记录
  if (!slots || !slots.length) return null;
  // 白天时段 (d 开头 = day) 取最高温, 描述取出现最多的天气
  const daySlots = slots.filter((s) => /,d\d+,/.test(s));
  const pick = daySlots.length ? daySlots : slots;
  let maxTemp = -99;
  const weatherCount = {};
  let wind = '';
  for (const s of pick) {
    const parts = s.split(',');
    if (parts.length < 4) continue;
    const t = parseInt(parts[3], 10);
    if (!isNaN(t) && t > maxTemp) maxTemp = t;
    const w = parts[2];
    if (w) weatherCount[w] = (weatherCount[w] || 0) + 1;
    if (!wind && parts[4]) wind = parts[4];
  }
  const weather = Object.entries(weatherCount).sort((a, b) => b[1] - a[1])[0];
  return { day: dayLabel, weather: weather ? weather[0] : '', temp: maxTemp > -99 ? maxTemp : '', wind };
}

(async () => {
  try {
    const dayOffset = parseInt(process.argv[2] || '0', 10);
    const ts = Date.now();
    // 1. IP 定位城市代码
    const ipResp = await get(`https://wgeo.weather.com.cn/ip/?_=${ts}`);
    const m = ipResp.match(/id="(\d{9})"/);
    if (!m) { console.log('定位失败'); process.exit(0); }
    const cityId = m[1];

    // 2. 实时 (sk_2d)
    const skResp = await get(`https://d1.weather.com.cn/sk_2d/${cityId}.html?_=${ts}`);
    const skStart = skResp.indexOf('{');
    const skEnd = skResp.lastIndexOf('}');
    let realtime = null;
    if (skStart >= 0 && skEnd > skStart) {
      const d = JSON.parse(skResp.slice(skStart, skEnd + 1));
      realtime = { city: d.cityname || '', temp: d.temp || '', weather: d.weather || '', wd: d.WD || '', ws: d.WS || '', sd: d.SD || '', aqi: d.aqi || '' };
    }

    // 3. 多日预报 (hour3data, https 页面)
    const page = await get(`https://www.weather.com.cn/weather/${cityId}.shtml`);
    if (dayOffset === 0 && realtime) {
      console.log(`${realtime.city} ${realtime.weather} ${realtime.temp}度 ${realtime.wd}${realtime.ws} 湿度${realtime.sd} 空气质量${realtime.aqi}`);
      process.exit(0);
    }
    const hIdx = page.indexOf('var hour3data=');
    if (hIdx < 0) { console.log('预报获取失败'); process.exit(0); }
    // 取 hour3data={...}; 的对象体: 从 { 开始, 深度匹配到 } 结束 (忽略字符串内括号)
    const hStart = page.indexOf('{', hIdx);
    let depth = 0, inStr = false, hEnd = -1;
    for (let i = hStart; i < page.length; i++) {
      const ch = page[i];
      if (inStr) { if (ch === '"' && page[i - 1] !== '\\') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { hEnd = i; break; } }
    }
    if (hEnd < 0) { console.log('预报数据解析失败'); process.exit(0); }
    const hour3 = JSON.parse(page.slice(hStart, hEnd + 1));
    // 7d 是二维数组, 每项是一天的 3 小时槽位
    const days = hour3['7d'] || [];
    const dayLabels = ['今天', '明天', '后天', '大后天', '大后天+1', '大后天+2'];
    if (dayOffset === 0 && days.length) {
      const today = hour3['1d'];
      const r = pickForecast(Array.isArray(today) ? today : [today], '今天');
      if (r) { console.log(`${realtime ? realtime.city : ''} ${r.weather} ${r.temp}度最高 ${r.wind}`); process.exit(0); }
    }
    const idx = dayOffset >= 1 ? dayOffset - 1 : 0;
    const target = days[idx];
    if (!target) { console.log('没有更多天的预报'); process.exit(0); }
    const r = pickForecast(target, dayLabels[dayOffset] || ('第' + (dayOffset + 1) + '天'));
    if (r) {
      console.log(`${realtime ? realtime.city : ''}${r.day}${r.weather}，最高${r.temp}度，${r.wind}`);
    } else {
      console.log('预报数据为空');
    }
  } catch (e) {
    console.log('查询失败: ' + e.message);
  }
})();

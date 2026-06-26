const crypto = require('crypto');
const https = require('https');

function generateToken(clientId, clientSecret) {
  const timestamp = Date.now().toString();
  const password = `${clientId}_${timestamp}`;
  const hashed = crypto.createHmac('sha256', clientSecret).update(password).digest('base64');
  return `${clientId}:${hashed}:${timestamp}`;
}

async function naverRequest(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.commerce.naver.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON 파싱 오류: ' + data)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { clientId, clientSecret, page = 1, size = 100 } = req.body;
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'clientId, clientSecret 필요' });

  try {
    const token = generateToken(clientId, clientSecret);

    // 상품 목록 조회
    const listData = await naverRequest(
      `/v1/products?page=${page}&size=${size}`,
      token
    );

    if (!listData.contents || listData.contents.length === 0) {
      return res.status(200).json({ products: [], total: 0, page, hasMore: false });
    }

    // 상품별 상세 조회 (옵션 포함)
    const details = await Promise.all(
      listData.contents.map(async (p) => {
        try {
          const detail = await naverRequest(`/v1/products/${p.originProductNo}`, token);
          return detail;
        } catch (e) {
          return p;
        }
      })
    );

    const total = listData.totalElements || 0;
    const hasMore = page * size < total;

    return res.status(200).json({ products: details, total, page, hasMore });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

const crypto = require('crypto');
const https = require('https');
const bcrypt = require('bcryptjs');

async function getAccessToken(clientId, clientSecret) {
  const timestamp = Date.now().toString();
  const password = `${clientId}_${timestamp}`;
  // bcryptjs로 해싱 (clientSecret을 salt로 사용)
  const hashed = await bcrypt.hash(password, clientSecret);
  const clientSecretSign = Buffer.from(hashed).toString('base64');

  const params = new URLSearchParams({
    client_id: clientId,
    timestamp: timestamp,
    client_secret_sign: clientSecretSign,
    grant_type: 'client_credentials',
    type: 'SELF'
  });

  return new Promise((resolve, reject) => {
    const bodyStr = params.toString();
    const options = {
      hostname: 'api.commerce.naver.com',
      path: '/external/v1/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error('토큰 발급 실패: ' + JSON.stringify(json)));
        } catch (e) { reject(new Error('토큰 응답 파싱 오류: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function naverGet(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.commerce.naver.com',
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
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

async function naverPost(path, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: 'api.commerce.naver.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
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
    req.write(bodyStr);
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
    // 1단계: OAuth2 액세스 토큰 발급
    const accessToken = await getAccessToken(clientId, clientSecret);

    // 2단계: 상품 목록 조회
    const searchBody = {
      page,
      size,
      orderType: 'NO',
      productStatusTypes: ['SALE', 'OUTOFSTOCK', 'SUSPENSION']
    };

    const listData = await naverPost('/external/v1/products/search', accessToken, searchBody);

    if (!listData.contents) {
      return res.status(200).json({ products: [], total: 0, page, hasMore: false, debug: listData });
    }

    if (listData.contents.length === 0) {
      return res.status(200).json({ products: [], total: listData.totalElements || 0, page, hasMore: false });
    }

    // 3단계: 상품별 상세 조회 (옵션 포함)
    const details = await Promise.all(
      listData.contents.map(async (p) => {
        try {
          return await naverGet(`/external/v1/products/origin-products/${p.originProductNo}`, accessToken);
        } catch (e) {
          return { ...p, detailError: e.message };
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

const https = require('https');
const crypto = require('crypto');

// Bütün həssas məlumatlar tamamilə GitHub Secrets (Environment Variables) üzərindən oxunur.
// KODUN İÇİNDƏ HEÇ BİR AÇAR VƏ YA ŞƏXSİ MƏLUMAT YOXDUR.
const OCI_KEY_B64 = process.env.OCI_PRIVATE_KEY_B64;
const TENANCY_ID = process.env.TENANCY_ID;
const AUTH_USER_ID = process.env.AUTH_USER_ID;
const KEY_FINGERPRINT = process.env.KEY_FINGERPRINT;
const BOOT_VOLUME_ID = process.env.BOOT_VOLUME_ID;
const SUBNET_ID = process.env.SUBNET_ID;
const SSH_PUBLIC_KEY = process.env.SSH_PUBLIC_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

if (!OCI_KEY_B64 || !TENANCY_ID || !AUTH_USER_ID || !KEY_FINGERPRINT) {
  console.error("XƏTA: Zəruri GitHub Secrets təyin olunmayıb!");
  process.exit(1);
}

const cleanKey = Buffer.from(OCI_KEY_B64, 'base64').toString('utf8');
const keyId = `${TENANCY_ID}/${AUTH_USER_ID}/${KEY_FINGERPRINT}`;
const iaasHost = "iaas.eu-frankfurt-1.oraclecloud.com";

function sendDiscord(desc, title = null, color = 0x22C55E) {
  if (!DISCORD_WEBHOOK) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const embed = {
        title: title || undefined,
        description: desc,
        color: color,
        timestamp: new Date().toISOString()
      };
      const data = JSON.stringify({ embeds: [embed] });
      const url = new URL(DISCORD_WEBHOOK);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }, (res) => {
        resolve();
      });
      req.on('error', () => resolve());
      req.write(data);
      req.end();
    } catch (e) {
      resolve();
    }
  });
}

function ociRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    let signingString = `date: ${date}\n(request-target): ${method.toLowerCase()} ${path}\nhost: ${iaasHost}`;
    let headersToSign = "date (request-target) host";
    let bodyBytes = null;
    let sha256 = null;

    if (body !== null) {
      bodyBytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
      sha256 = crypto.createHash('sha256').update(bodyBytes).digest('base64');
      signingString += `\nx-content-sha256: ${sha256}\ncontent-type: application/json\ncontent-length: ${bodyBytes.length}`;
      headersToSign += " x-content-sha256 content-type content-length";
    }

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingString);
    const signature = signer.sign(cleanKey, 'base64');
    const authHeader = `Signature version="1",headers="${headersToSign}",keyId="${keyId}",algorithm="rsa-sha256",signature="${signature}"`;

    const reqHeaders = {
      'date': date,
      'host': iaasHost,
      'authorization': authHeader
    };

    if (body !== null) {
      reqHeaders['x-content-sha256'] = sha256;
      reqHeaders['content-type'] = 'application/json';
      reqHeaders['content-length'] = bodyBytes.length;
    }

    const req = https.request({
      hostname: iaasHost,
      path: path,
      method: method,
      headers: reqHeaders
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(resBody);
          resolve({ status: res.statusCode, data: parsed, raw: resBody });
        } catch(e) {
          resolve({ status: res.statusCode, data: null, raw: resBody });
        }
      });
    });

    req.on('error', reject);
    if (bodyBytes) {
      req.write(bodyBytes);
    }
    req.end();
  });
}

async function tryLaunch() {
  const payload = {
    compartmentId: TENANCY_ID,
    availabilityDomain: "XAgw:EU-FRANKFURT-1-AD-1",
    displayName: "instance-20261119-arm",
    shape: "VM.Standard.A1.Flex",
    shapeConfig: {
      ocpus: 1,
      memoryInGBs: 6
    },
    sourceDetails: {
      sourceType: "bootVolume",
      bootVolumeId: BOOT_VOLUME_ID
    },
    createVnicDetails: {
      subnetId: SUBNET_ID,
      assignPublicIp: true
    },
    metadata: {
      ssh_authorized_keys: SSH_PUBLIC_KEY
    }
  };

  return await ociRequest("POST", "/20160918/instances/", payload);
}

async function main() {
  console.log("=== Oracle Cloud 24/7 ARM Sniper Başladı (Təhlükəsiz Secrets Rejimi) ===");
  console.log("Hədəf: Frankfurt AD-1, Shape: VM.Standard.A1.Flex (1 OCPU, 6 GB RAM)");
  console.log("Qoşulacaq Disk: 200 GB Boot Volume");

  await sendDiscord(
    "🟢 **Oracle Cloud 7/24 Sniper işə düşdü! (Təhlükəsiz Secrets Rejimi)**\n\n" +
    "• **Status:** Bütün açarlar 100% şifrəli GitHub Secrets-dən oxunur\n" +
    "• **Region:** Frankfurt (`eu-frankfurt-1` AD-1)\n" +
    "• **Disk:** 200 GB Foxname Boot Volume\n" +
    "• **Hədəf:** VM.Standard.A1.Flex (1 OCPU, 6 GB RAM)\n" +
    "• **Tezlik:** Hər 15 saniyədən bir canlı yoxlanılır",
    "Oracle Sniper: Şifrəli & Təhlükəsiz Rejimdə Aktivdir",
    0x22C55E
  );

  const startTime = Date.now();
  const maxRuntime = (5 * 3600 - 300) * 1000; // 4 saat 55 dəqiqə
  let attempt = 0;
  let lastDiscordReport = Date.now();

  while (Date.now() - startTime < maxRuntime) {
    attempt++;
    const nowStr = new Date().toLocaleTimeString('az-AZ');
    try {
      const res = await tryLaunch();
      if (res.status === 200 || res.status === 201) {
        const instId = res.data ? res.data.id : "Unknown";
        console.log(`\n🎉 [${nowStr}] MƏQSƏDƏ ÇATILDI! Server Yaradıldı! ID: ${instId}`);
        await sendDiscord(
          `@everyone 🎉 **MƏQSƏDƏ ÇATILDI! ORACLE SERVERİ YARADILDI!**\n\n` +
          `• **Instance ID:** \`${instId}\`\n` +
          `• **Region:** Frankfurt AD-1\n` +
          `• **Shape:** VM.Standard.A1.Flex (1 OCPU, 6 GB RAM)\n` +
          `• **Disk:** 200 GB Boot Volume uğurla qoşuldu!\n` +
          `• **Status:** Running`,
          "🎉 ORACLE SERVER QALDIRILDI!",
          0xF59E0B
        );
        process.exit(0);
      } else if (res.status === 500) {
        console.log(`[${nowStr}] [Cəhd #${attempt}] Out of host capacity. Boş yer hələ yoxdur...`);
      } else {
        console.log(`[${nowStr}] [Cəhd #${attempt}] Status: ${res.status} - ${res.data ? res.data.message : res.raw}`);
      }
    } catch(err) {
      console.log(`[${nowStr}] Xəta: ${err.message}`);
    }

    // Hər 30 dəqiqədən bir Discord-a status hesabatı göndər
    if (Date.now() - lastDiscordReport >= 30 * 60 * 1000) {
      const elapsedMin = Math.floor((Date.now() - startTime) / 60000);
      await sendDiscord(
        `⏳ **Sniper aktivdir və ov davam edir...**\n` +
        `• **Cəhd sayı:** ${attempt}\n` +
        `• **Keçən müddət:** ${elapsedMin} dəqiqə\n` +
        `• **Status:** Frankfurt AD-1 fasiləsiz yoxlanılır.`,
        "Sniper Canlı Hesabat",
        0x3B82F6
      );
      lastDiscordReport = Date.now();
    }

    await new Promise(r => setTimeout(r, 15000));
  }

  console.log("5 saatlıq sessiya tamamlandı. Növbəti GitHub Action sessiyası başlayacaq.");
}

main().catch(console.error);
